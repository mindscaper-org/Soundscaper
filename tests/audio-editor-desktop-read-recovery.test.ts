/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeDesktopReadBlob } from '../src/common/editor/desktop-read-materialization.ts';
import { createDesktopLinkedOriginalAccess } from '../src/common/editor/desktop-linked-original-port.ts';

test('desktop materialization bounds an idle response body and cancels its transport', async () => {
	let cancelled = 0;
	const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined), cancel() { cancelled += 1; } });
	await assert.rejects(materializeDesktopReadBlob({ url: 'soundscaper-app://bundle/read', size: 1 }, {
		fetch: async () => new Response(body, { headers: { 'Content-Length': '1' } }),
		signal: new AbortController().signal, idleTimeoutMs: 5,
	}), { name: 'TimeoutError' });
	assert.equal(cancelled, 1);
});

test('desktop materialization resumes after a transient fetch failure without changing the descriptor', async () => {
	let requests = 0;
	const blob = await materializeDesktopReadBlob({ url: 'soundscaper-app://bundle/read', size: 1 }, {
		fetch: async () => {
			requests += 1;
			if (requests === 1) throw new TypeError('Failed to fetch');
			return new Response(Uint8Array.of(7), { headers: { 'Content-Length': '1' } });
		}, signal: new AbortController().signal,
	});
	assert.equal(requests, 2);
	assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), Uint8Array.of(7));
});

for (const ranged of [false, true]) {
	test(`cancelling a stalled linked audio admission releases its eventual descriptor (range=${String(ranged)})`, async () => {
		const request = deferred<unknown>();
		const releases: string[] = [];
		const access = createDesktopLinkedOriginalAccess({
			bridge: {
				loadLinkedAudioOriginal: () => request.promise,
				reconcileLinkedOriginals: () => 0,
				releaseLinkedOriginal: () => true,
				releaseRead(id) { releases.push(id); return true; },
			},
			fetch: async () => { throw new Error('Admission was cancelled.'); },
			videoPort: { load: () => null }, openReadDescriptor: async () => new Blob(),
		});
		assert.ok(access.port);
		const controller = new AbortController();
		const options = { expectedRevision: 'b'.repeat(64), signal: controller.signal };
		const pending = ranged ? access.port.leaseRange?.('audio', 'a'.repeat(64), options)
			: access.port.load('audio', 'a'.repeat(64), options);
		assert.ok(pending);
		await Promise.resolve();
		const reason = new Error('Stop source loading');
		controller.abort(reason);
		await assert.rejects(pending, error => error === reason);
		request.resolve({ descriptor: { id: 'c'.repeat(64) } });
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(releases, ['c'.repeat(64)]);
	});
}

test('a stalled linked read release reports a bounded cleanup error while main keeps the OS handle', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const released = deferred<boolean>();
	let releaseCalls = 0;
	const id = 'c'.repeat(64);
	const access = createDesktopLinkedOriginalAccess({
		bridge: {
			loadLinkedAudioOriginal: () => ({ locatorRevision: 'b'.repeat(64), descriptor: {
				id, name: 'selected.wav', size: 1, mimeType: 'audio/wav', readProfile: 'linked-audio-range-v1', lastModified: 0,
				url: `soundscaper-app://bundle/_desktop/read/linked-audio-range-v1/${id}/selected.wav`,
			} }),
			reconcileLinkedOriginals: () => 0, releaseLinkedOriginal: () => true,
			releaseRead() { releaseCalls += 1; return released.promise; },
		},
		fetch: async () => { throw new Error('Only release is exercised.'); },
		videoPort: { load: () => null }, openReadDescriptor: async () => new Blob(),
	});
	const lease = await access.port?.leaseRange?.('audio', 'a'.repeat(64), { expectedRevision: 'b'.repeat(64) });
	assert.ok(lease);
	const releasing = lease.release();
	const rejection = assert.rejects(releasing, { name: 'TimeoutError' });
	for (let turn = 0; turn < 5 && releaseCalls === 0; turn += 1) await Promise.resolve();
	assert.equal(releaseCalls, 1);
	context.mock.timers.tick(5_001);
	await rejection;
	assert.equal(lease.release(), releasing, 'the timed-out cleanup remains one owned release');
	released.reject(new Error('The OS eventually reported a disconnected share.'));
	await new Promise(resolve => setImmediate(resolve));
});

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((resolveValue, rejectValue) => { resolve = resolveValue; reject = rejectValue; });
	return { promise, resolve, reject };
}
