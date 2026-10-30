/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { analyzeClipNormalizationChannels } from '../src/common/editor/controller/clip-video/internal/clip-normalization-analysis.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

type WorkerEvent = { data?: unknown; error?: unknown; message?: string };
type Listener = (event: WorkerEvent) => void;
class StreamingWorker {
	static instances: StreamingWorker[] = [];
	static afterChunk: (() => void) | null = null;
	readonly thread: NodeWorker;
	readonly chunkFrames: number[] = [];
	start: unknown;
	onmessage: Listener | null = null;
	onerror: Listener | null = null;
	onmessageerror: Listener | null = null;
	termination: Promise<number> | null = null;
	constructor(module: URL) {
		StreamingWorker.instances.push(this);
		this.thread = new NodeWorker(new URL('./fixtures/streaming-analysis-worker.ts', import.meta.url), { workerData: module.href });
		this.thread.on('message', (data: unknown) => { this.emit('message', { data }); });
		this.thread.on('error', error => { this.emit('error', { error }); });
	}
	emit(type: string, event: WorkerEvent) {
		if (type === 'message') this.onmessage?.(event); else if (type === 'error') this.onerror?.(event);
	}
	postMessage(value: unknown, transfer: readonly Transferable[] = []) {
		assert.ok(value && typeof value === 'object' && 'type' in value);
		if (value.type === 'start') this.start = structuredClone(value);
		if (value.type === 'chunk') {
			assert.ok('channels' in value && Array.isArray(value.channels));
			const channels = value.channels as readonly unknown[];
			assert.ok(channels[0] instanceof ArrayBuffer);
			this.chunkFrames.push(channels[0].byteLength / 4);
		}
		this.thread.postMessage(value, transfer.map(item => { assert.ok(item instanceof ArrayBuffer); return item; }));
		if (value.type === 'chunk') StreamingWorker.afterChunk?.();
	}
	terminate() { this.termination ??= this.thread.terminate(); }
}

async function withWorker(operation: () => Promise<void>) {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	StreamingWorker.instances = []; StreamingWorker.afterChunk = null;
	Reflect.set(globalThis, 'Worker', StreamingWorker);
	try { await operation(); }
	finally {
		if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor); else Reflect.deleteProperty(globalThis, 'Worker');
		for (const worker of StreamingWorker.instances) worker.terminate();
		await Promise.all(StreamingWorker.instances.map(worker => worker.termination));
		StreamingWorker.afterChunk = null;
	}
}

test('the real streaming analysis worker measures only sample peak with bounded copied PCM transfers', async () => {
	await withWorker(async () => {
		const frames = 65_536 * 2 + 17, channels = [new Float32Array(frames).fill(-0.75), new Float32Array(frames).fill(0.25)];
		assert.deepEqual(await analyzeClipNormalizationChannels(channels, 48_000, ENGLISH_COPY, new AbortController().signal, true), { peakAmplitude: 0.75, integratedLufs: null });
		const worker = StreamingWorker.instances[0]!;
		assert.deepEqual(worker.chunkFrames, [65_536, 65_536, 17]);
		assert.ok(worker.start && typeof worker.start === 'object' && 'options' in worker.start);
		assert.ok(worker.start.options && typeof worker.start.options === 'object' && 'samplePeakOnly' in worker.start.options && worker.start.options.samplePeakOnly === true);
		assert.equal(channels[0]!.length, frames); assert.equal(channels[0]![0], -0.75);
		assert.ok(worker.termination);
		await assert.rejects(analyzeClipNormalizationChannels([Float32Array.of(Infinity)], 48_000, ENGLISH_COPY, new AbortController().signal, true), /finite/);
	});
});

test('cancelling real peak worker I/O retires its job before another PCM packet transfers', async () => {
	await withWorker(async () => {
		const controller = new AbortController();
		StreamingWorker.afterChunk = () => { controller.abort(); };
		const channels = [new Float32Array(65_536 * 4).fill(0.5)];
		await assert.rejects(analyzeClipNormalizationChannels(channels, 48_000, ENGLISH_COPY, controller.signal, true), { name: 'AbortError' });
		assert.deepEqual(StreamingWorker.instances[0]!.chunkFrames, [65_536]);
		assert.ok(StreamingWorker.instances[0]!.termination);
		assert.equal(channels[0]!.length, 65_536 * 4);
	});
});
