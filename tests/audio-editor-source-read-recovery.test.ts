/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import {
	readSourceWithRecovery,
	SourceReadConnectionError,
} from '../src/common/editor/storage/source-read-recovery.ts';
import { createLinkedOriginalRangeByteSource } from '../src/common/editor/storage/linked-original-range-byte-source.ts';
import { readDesktopLinkedOriginalRange } from '../src/common/editor/storage/desktop-linked-original-range-reader.ts';

test('source reads automatically recover transient I/O while retaining cancellation identity', async () => {
	const signal = new AbortController().signal;
	const attempts: AbortSignal[] = [];
	const messages: string[] = [];
	const actual = await readSourceWithRecovery(async current => {
		attempts.push(current);
		if (attempts.length < 3) throw Object.assign(new Error('private mounted path'), { code: 'ENOENT' });
		return 42;
	}, { signal, retryDelayMs: 0, log: message => { messages.push(message); } });
	assert.equal(actual, 42);
	assert.equal(attempts.length, 3);
	assert.equal(new Set(attempts).size, 3);
	assert.equal(messages.length, 3);
	assert.ok(messages.every(message => !message.includes('private')));
	assert.equal(getEventListeners(signal, 'abort').length, 0);
});

test('source read deadlines bound an uncooperative provider and consume its late rejection', async () => {
	let attempts = 0;
	const signals: AbortSignal[] = [];
	const rejectLate: Array<(error: unknown) => void> = [];
	await assert.rejects(readSourceWithRecovery(signal => {
		attempts += 1; signals.push(signal);
		return new Promise((_resolve, reject) => { rejectLate.push(reject); });
	}, { attemptTimeoutMs: 5, maximumAttempts: 2, retryDelayMs: 0, log: () => undefined }), { name: 'TimeoutError' });
	assert.equal(attempts, 2);
	assert.ok(signals.every(signal => signal.aborted));
	for (const reject of rejectLate) reject(new Error('late abandoned failure'));
	await new Promise(resolve => setImmediate(resolve));
});

test('steady source progress refreshes the idle deadline without limiting total read duration', async () => {
	const value = await readSourceWithRecovery(async (_signal, progress?: () => void) => {
		for (let chunk = 0; chunk < 5; chunk += 1) {
			await new Promise(resolve => setTimeout(resolve, 4));
			progress?.();
		}
		return 19;
	}, { attemptTimeoutMs: 10, maximumAttempts: 1 });
	assert.equal(value, 19);
});

test('a read that stops progressing still reaches its idle deadline', async () => {
	let lateProgress: (() => void) | undefined;
	await assert.rejects(readSourceWithRecovery((_signal, progress?: () => void) => {
		lateProgress = progress;
		progress?.();
		return new Promise(() => undefined);
	}, { attemptTimeoutMs: 5, maximumAttempts: 1 }), { name: 'TimeoutError' });
	lateProgress?.();
});

test('source read cancellation interrupts retry backoff and never restarts the provider', async () => {
	const controller = new AbortController();
	const reason = new Error('user stopped playback');
	let attempts = 0;
	const reading = readSourceWithRecovery(async () => {
		attempts += 1;
		throw new SourceReadConnectionError();
	}, { signal: controller.signal, retryDelayMs: 10_000, log: () => { controller.abort(reason); } });
	await assert.rejects(reading, error => error === reason);
	assert.equal(attempts, 1);
	assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('a transport that answers after its deadline has its late resource released', async () => {
	let resolveLate!: (value: object) => void;
	const released: object[] = [];
	await assert.rejects(readSourceWithRecovery(() => new Promise<object>(resolve => { resolveLate = resolve; }), {
		attemptTimeoutMs: 5, maximumAttempts: 1,
		discardLateValue: value => { released.push(value); },
	}), { name: 'TimeoutError' });
	const value = {};
	resolveLate(value);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(released, [value]);
});

test('cancellation racing resolved read delivery wins and releases the abandoned result', async () => {
	const controller = new AbortController();
	const reason = new Error('Playback was replaced while the read result was arriving.');
	const value = {};
	const discarded: object[] = [];
	await assert.rejects(readSourceWithRecovery(() => {
		queueMicrotask(() => { queueMicrotask(() => { controller.abort(reason); }); });
		return value;
	}, { signal: controller.signal, discardLateValue: abandoned => { discarded.push(abandoned); } }),
		error => error === reason);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(discarded, [value]);
});

for (const failure of [new TypeError('invalid channels'), new Error('SHA-256 mismatch'), new DOMException('permission denied', 'NotAllowedError')]) {
	test(`source reads never retry validation or authorization errors: ${failure.message}`, async () => {
		let attempts = 0;
		await assert.rejects(readSourceWithRecovery(async () => { attempts += 1; throw failure; }, {
			retryDelayMs: 0, log: () => undefined,
		}), error => error === failure);
		assert.equal(attempts, 1);
	});
}

test('a linked original range retries the same exact byte request after a temporary disappearance', async () => {
	const requests: Array<Readonly<{ offset: number; length: number }>> = [];
	const source = createLinkedOriginalRangeByteSource({ size: 4, type: 'audio/wav', readRange(request) {
		requests.push({ offset: request.offset, length: request.length });
		if (requests.length === 1) throw Object.assign(new Error('temporarily disconnected share'), { code: 'ENOENT' });
		return Uint8Array.of(1, 2);
	} });
	assert.deepEqual(await source.slice(1, 3), Uint8Array.of(1, 2));
	assert.deepEqual(requests, [{ offset: 1, length: 2 }, { offset: 1, length: 2 }]);
});

test('a recovered range still rejects inexact bytes instead of retrying changed media', async () => {
	let attempts = 0;
	const source = createLinkedOriginalRangeByteSource({ size: 4, type: 'audio/wav', readRange() {
		attempts += 1;
		return new Uint8Array(1);
	} });
	await assert.rejects(source.slice(0, 2), /inexact bytes/u);
	assert.equal(attempts, 1);
});

test('direct desktop ranges recover transport failures for selected imports and legacy video', async () => {
	let requests = 0;
	const bytes = await readDesktopLinkedOriginalRange({ url: 'soundscaper-app://bundle/read', size: 2, mimeType: 'audio/wav' },
		{ offset: 0, length: 2 }, async () => {
			requests += 1;
			if (requests === 1) throw new TypeError('Failed to fetch');
			return new Response(Uint8Array.of(3, 4), { status: 206, headers: {
				'Accept-Ranges': 'bytes', 'Content-Length': '2', 'Content-Range': 'bytes 0-1/2', 'Content-Type': 'audio/wav',
			} });
		}, 'selected');
	assert.deepEqual(bytes, Uint8Array.of(3, 4));
	assert.equal(requests, 2);
});

test('an admitted desktop range recovers after a temporarily missing remote file returns', async () => {
	let requests = 0;
	const bytes = await readDesktopLinkedOriginalRange({ url: 'soundscaper-app://bundle/read', size: 2, mimeType: 'audio/wav' },
		{ offset: 0, length: 2 }, async () => {
			requests += 1;
			if (requests === 1) return new Response('Not found', { status: 404 });
			return new Response(Uint8Array.of(8, 9), { status: 206, headers: {
				'Accept-Ranges': 'bytes', 'Content-Length': '2', 'Content-Range': 'bytes 0-1/2', 'Content-Type': 'audio/wav',
			} });
		}, 'audio');
	assert.equal(requests, 2);
	assert.deepEqual(bytes, Uint8Array.of(8, 9));
});

test('desktop range authorization and explicit revision conflict responses remain terminal', async () => {
	for (const status of [401, 403, 409]) {
		let requests = 0;
		await assert.rejects(readDesktopLinkedOriginalRange({ url: 'soundscaper-app://bundle/read', size: 2, mimeType: 'audio/wav' },
			{ offset: 0, length: 2 }, async () => { requests += 1; return new Response('refused', { status }); }, 'audio'),
			new RegExp(`status ${status}`, 'u'));
		assert.equal(requests, 1);
	}
});

test('desktop range deadlines follow incoming bytes instead of the total slow transfer time', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	let output!: ReadableStreamDefaultController<Uint8Array>;
	const body = new ReadableStream<Uint8Array>({ start(controller) { output = controller; } });
	const pending = readDesktopLinkedOriginalRange({ url: 'soundscaper-app://bundle/read', size: 2, mimeType: 'audio/wav' },
		{ offset: 0, length: 2 }, async () => rangeResponse(body), 'audio');
	await settleReads();
	context.mock.timers.tick(4_000);
	output.enqueue(Uint8Array.of(1));
	await settleReads();
	context.mock.timers.tick(4_000);
	output.enqueue(Uint8Array.of(2)); output.close();
	assert.deepEqual(await pending, Uint8Array.of(1, 2));
});

test('empty desktop range chunks cannot extend a disconnected read indefinitely', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	let output!: ReadableStreamDefaultController<Uint8Array>;
	let attemptSignal: AbortSignal | null | undefined;
	const controller = new AbortController();
	const body = new ReadableStream<Uint8Array>({ start(value) { output = value; } });
	const pending = readDesktopLinkedOriginalRange({ url: 'soundscaper-app://bundle/read', size: 2, mimeType: 'audio/wav' },
		{ offset: 0, length: 2, signal: controller.signal }, async (_url, init) => {
			attemptSignal = init.signal; return rangeResponse(body);
		}, 'audio');
	const failure = pending.then(() => null, (error: unknown) => error);
	await settleReads();
	context.mock.timers.tick(4_000);
	output.enqueue(new Uint8Array(0));
	await settleReads();
	context.mock.timers.tick(1_001);
	await settleReads();
	assert.equal(attemptSignal?.aborted, true);
	const reason = new Error('User stopped retrying.');
	controller.abort(reason);
	assert.equal(await failure, reason);
});

test('nested immutable range layers share one bounded transport retry budget', async () => {
	let requests = 0;
	const source = createLinkedOriginalRangeByteSource({ size: 2, type: 'audio/wav', boundedReads: true, readRange(request) {
		return readDesktopLinkedOriginalRange({ url: 'soundscaper-app://bundle/read', size: 2, mimeType: 'audio/wav' },
			request, async () => { requests += 1; throw new TypeError('Failed to fetch'); }, 'audio');
	} });
	await assert.rejects(source.slice(0, 2));
	assert.equal(requests, 3);
});

function rangeResponse(body: ReadableStream<Uint8Array>): Response {
	return new Response(body, { status: 206, headers: {
		'Accept-Ranges': 'bytes', 'Content-Length': '2', 'Content-Range': 'bytes 0-1/2', 'Content-Type': 'audio/wav',
	} });
}

async function settleReads(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}
