/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ChunkStreamClient } from '../src/common/editor/chunk-stream-client.js';
import { normalizeChunkSource } from '../src/common/editor/engine/clip-schedule-plan.ts';
import { createReversedChunkSource } from '../src/common/editor/engine/clip-scheduler-chunk-sources.ts';
import { createStoredChunkProvider } from '../src/common/editor/controller/source/source-audio.ts';

test('a missing worker/worklet handshake rejects all stream stages and releases its endpoints', { timeout: 500 }, async () => {
	const fixture = setup({ openingTimeoutMs: 5 });
	try {
		for (const error of await fixture.rejections) assert.equal((error as Error).name, 'TimeoutError');
		assert.equal(fixture.handle.state, 'closed');
		assert.equal(fixture.client.streams.size, 0);
		assert.equal(fixture.output.messages.at(-1)?.type, 'cancel-stream');
	} finally { fixture.client.dispose(); }
});

test('a caller observing only stream readiness does not leak failures from the other stages', async () => {
	const client = new ChunkStreamClient({ openingTimeoutMs: 5, workerFactory: () => new Endpoint(),
		messageChannelFactory: () => ({ port1: new Endpoint(), port2: new Endpoint() }) });
	try {
		const handle = client.open({ source: { channelCount: 1, frameCount: 128, chunkFrames: 128,
			readStorageChunk: () => [new Float32Array(128)] }, outputPort: new Endpoint() });
		await assert.rejects(handle.ready, { name: 'TimeoutError' });
		await new Promise(resolve => setImmediate(resolve));
	} finally { client.dispose(); }
});

test('a stalled storage read fails playback without waiting for an ignored abort', { timeout: 500 }, async () => {
	let sourceSignal: AbortSignal | undefined;
	let rejectLate!: (error: unknown) => void;
	const fixture = setup({ readTimeoutMs: 5 }, async signal => {
		sourceSignal = signal;
		return await new Promise((_resolve, reject) => { rejectLate = reject; });
	});
	try {
		fixture.worker.dispatch({ type: 'stream-ready', streamId: 'recovery', protocolVersion: 1 });
		fixture.output.dispatch({ type: 'worklet-ready', streamId: 'recovery', protocolVersion: 1, capacity: 1 });
		fixture.worker.dispatch({ type: 'need-storage-chunk', streamId: 'recovery', requestId: 1, chunkIndex: 0, frames: 128 });
		await waitUntil(() => fixture.worker.messages.some(message => message.type === 'storage-error'));
		const failure = fixture.worker.messages.find(message => message.type === 'storage-error');
		assert.equal((failure?.error as Error).name, 'TimeoutError');
		assert.equal(sourceSignal?.aborted, true);
		rejectLate(new Error('late source failure'));
		await new Promise(resolve => setImmediate(resolve));
	} finally { fixture.client.dispose(); await fixture.rejections; }
});

test('linked verification uses its per-range deadlines instead of a whole-file playback limit', { timeout: 500 }, async () => {
	const fixture = setup({ readTimeoutMs: 2, openingTimeoutMs: 2 }, async () => {
		await new Promise(resolve => setTimeout(resolve, 15));
		return [new Float32Array(128)];
	}, { boundedReads: true });
	try {
		fixture.worker.dispatch({ type: 'stream-ready', streamId: 'recovery', protocolVersion: 1 });
		fixture.output.dispatch({ type: 'worklet-ready', streamId: 'recovery', protocolVersion: 1, capacity: 1 });
		fixture.worker.dispatch({ type: 'need-storage-chunk', streamId: 'recovery', requestId: 1, chunkIndex: 0, frames: 128 });
		await waitUntil(() => fixture.worker.messages.some(message => message.type === 'storage-chunk'));
		assert.equal(fixture.worker.messages.some(message => message.type === 'storage-error'), false);
	} finally { fixture.client.dispose(); await fixture.rejections; }
});

test('stored linked providers retain read deadline ownership through normal and reverse scheduling', async () => {
	const provider = createStoredChunkProvider({ readSourceChunk: () => [new Float32Array(128)] },
		{ id: 'linked', channelCount: 1, sampleRate: 48_000, frameCount: 128, chunkFrames: 128 },
		{ storage: 'linked-audio-original-v1', chunkFrames: 128 });
	try {
		assert.equal(provider.boundedReads, true);
		assert.equal(normalizeChunkSource(provider).boundedReads, true);
		assert.equal(createReversedChunkSource(normalizeChunkSource(provider)).boundedReads, true);
	} finally { await provider.dispose(); }
});

function setup(options: Readonly<Record<string, number>>, read: (signal: AbortSignal) => Promise<unknown> = async () => [new Float32Array(128)], sourceOptions: Readonly<{ boundedReads?: boolean }> = {}) {
	const worker = new Endpoint();
	const output = new Endpoint();
	const client = new ChunkStreamClient({ ...options, workerFactory: () => worker,
		messageChannelFactory: () => ({ port1: new Endpoint(), port2: new Endpoint() }) });
	const handle = client.open({ streamId: 'recovery', source: { ...sourceOptions, channelCount: 1, frameCount: 128, chunkFrames: 128,
		readStorageChunk: (_index: number, context: Readonly<{ signal: AbortSignal }>) => read(context.signal) }, outputPort: output });
	const rejections = Promise.all([handle.ready, handle.primed, handle.done].map(async (promise: Promise<unknown>) => {
		try { return await promise; } catch (error) { return error; }
	}));
	return { worker, output, client, handle, rejections };
}

class Endpoint {
	readonly messages: Record<string, unknown>[] = [];
	readonly listeners = new Map<string, Set<(event: { data: Record<string, unknown> }) => void>>();
	postMessage(message: Record<string, unknown>): void { this.messages.push(message); }
	addEventListener(type: string, listener: (event: { data: Record<string, unknown> }) => void): void {
		const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners);
	}
	removeEventListener(type: string, listener: (event: { data: Record<string, unknown> }) => void): void { this.listeners.get(type)?.delete(listener); }
	dispatch(data: Record<string, unknown>): void { for (const listener of this.listeners.get('message') ?? []) listener({ data }); }
	start(): void {}
	close(): void {}
	terminate(): void {}
}

async function waitUntil(ready: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (ready()) return;
		await new Promise(resolve => setTimeout(resolve, 1));
	}
	assert.fail('The source read watchdog did not settle.');
}
