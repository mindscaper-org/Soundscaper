/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { createProtocolHandler } from '../desktop/protocol.js';
import { createDesktopSelectedRangeBlob } from '../src/common/editor/desktop-selected-range-blob.ts';

async function fixture(context: TestContext, count = 1) {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-selected-read-queue-'));
	const owner = {};
	const store = new ReadCapabilityStore();
	context.after(async () => {
		await store.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	const handler = createProtocolHandler({
		rendererRoot: '/unused', runtimeRoot: '/unused', readCapabilities: store,
	});
	const descriptors = [];
	for (let index = 0; index < count; index += 1) {
		const path = join(directory, `audio-${index}.wav`);
		await writeFile(path, Uint8Array.from({ length: 32 }, (_, offset) => index + offset));
		descriptors.push(await store.registerSelectedRangePath(path, { owner }));
	}
	return { owner, store, handler, descriptors };
}

test('overlapping slices of one desktop audio selection wait for the active response', async (context) => {
	const { handler, descriptors } = await fixture(context);
	const blob = createDesktopSelectedRangeBlob(descriptors[0]!, {
		fetch: (url, init) => handler(new Request(url, init)),
	});
	const results = await Promise.allSettled([
		blob.slice(0, 4).bytes(), blob.slice(12, 16).bytes(), blob.slice(28, 32).bytes(),
	]);
	assert.deepEqual(results, [0, 12, 28].map((start) => ({
		status: 'fulfilled', value: Uint8Array.from({ length: 4 }, (_, offset) => start + offset),
	})));
});

test('desktop audio selections exceeding four active reads queue instead of returning 404', async (context) => {
	const { handler, descriptors } = await fixture(context, 7);
	const results = await Promise.allSettled(descriptors.map((descriptor) => (
		createDesktopSelectedRangeBlob(descriptor, {
			fetch: (url, init) => handler(new Request(url, init)),
		}).slice(4, 8).bytes()
	)));
	assert.deepEqual(results, descriptors.map((_, index) => ({
		status: 'fulfilled', value: Uint8Array.from({ length: 4 }, (_, offset) => index + offset + 4),
	})));
});

test('a selected read keeps its slot until the response body completes', async (context) => {
	const { handler, descriptors } = await fixture(context, 5);
	const request = (index: number, signal?: AbortSignal) => handler(new Request(descriptors[index]!.url, {
		headers: { Range: 'bytes=0-3' }, ...(signal ? { signal } : {}),
	}));
	const active = await Promise.all([0, 1, 2, 3].map((index) => request(index)));
	assert.deepEqual(active.map((response) => response.status), [206, 206, 206, 206]);
	let queuedSettled = false;
	const queued = request(4).then((response) => { queuedSettled = true; return response; });
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(queuedSettled, false, 'the fifth response waits for a body to finish');
	await active[0]!.arrayBuffer();
	const admitted = await queued;
	assert.equal(admitted.status, 206);
	await Promise.all([...active.slice(1), admitted].map((response) => response.arrayBuffer()));
});

test('aborting a queued selected read leaves the active read and later requests usable', async (context) => {
	const { store, descriptors } = await fixture(context);
	const descriptor = descriptors[0]!;
	const active = store.acquireRequest(descriptor.id, descriptor.readProfile);
	assert.ok(active);
	const controller = new AbortController();
	const queued = store.acquireQueuedRequest(descriptor.id, descriptor.readProfile, controller.signal);
	const reason = new DOMException('Import cancelled', 'AbortError');
	controller.abort(reason);
	await assert.rejects(queued, (error: unknown) => error === reason);
	assert.equal(store.acquireRequest(descriptor.id, descriptor.readProfile), null);
	await active.close();
	const next = await store.acquireQueuedRequest(descriptor.id, descriptor.readProfile, new AbortController().signal);
	assert.ok(next);
	await next.close();
});

test('cancelling a selected response admits its queued read without retiring the selection', async (context) => {
	const { handler, descriptors, store } = await fixture(context);
	const descriptor = descriptors[0]!;
	const request = () => handler(new Request(descriptor.url, { headers: { Range: 'bytes=0-3' } }));
	const active = await request();
	const queued = request();
	await active.body!.cancel();
	const next = await queued;
	assert.equal(next.status, 206);
	assert.deepEqual(new Uint8Array(await next.arrayBuffer()), Uint8Array.of(0, 1, 2, 3));
	assert.ok(store.get(descriptor.id));
});

test('owner revocation fences queued selected reads before they acquire a lease', async (context) => {
	const { store, descriptors, owner } = await fixture(context);
	const descriptor = descriptors[0]!;
	assert.ok(store.acquireRequest(descriptor.id, descriptor.readProfile));
	const queued = store.acquireQueuedRequest(descriptor.id, descriptor.readProfile, new AbortController().signal);
	await store.revokeOwner(owner);
	assert.equal(await queued, null);
	assert.equal(store.get(descriptor.id), null);
});
