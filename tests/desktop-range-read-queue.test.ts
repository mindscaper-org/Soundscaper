/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { MAX_READ_CAPABILITIES_PER_OWNER } from '../desktop/constants.js';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { createProtocolHandler } from '../desktop/protocol.js';
import { remainsPending } from './helpers/async-test-control.ts';

type Kind = 'audio' | 'video' | 'archive';

async function fixture(context: TestContext, kind: Kind, count = 1) {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-range-queue-'));
	const store = new ReadCapabilityStore();
	const owner = {};
	context.after(async () => { await store.dispose(); await rm(directory, { recursive: true, force: true }); });
	const descriptors: Array<NonNullable<ReturnType<ReadCapabilityStore['get']>>> = [];
	for (let index = 0; index < count; index += 1) {
		const path = join(directory, `${index}.${kind === 'archive' ? 'sscape' : kind === 'audio' ? 'wav' : 'mp4'}`);
		await writeFile(path, Uint8Array.of(1, 2, 3, 4));
		const details = await stat(path);
		descriptors.push(kind === 'archive'
			? await store.registerScapeRangePath(path, { owner })
			: await store.registerLinkedOriginalRangePath(path, {
				owner, kind, mimeType: kind === 'audio' ? 'audio/wav' : 'video/mp4',
				displayName: `${index}.${kind === 'audio' ? 'wav' : 'mp4'}`,
				expectedIdentity: { dev: details.dev, ino: details.ino, size: details.size,
					mtimeMs: details.mtimeMs, ctimeMs: details.ctimeMs },
			}));
	}
	const handler = createProtocolHandler({ rendererRoot: directory, runtimeRoot: directory, readCapabilities: store });
	const request = (index = 0, signal?: AbortSignal) => handler(new Request(descriptors[index]!.url, {
		headers: { Range: 'bytes=0-3' }, ...(signal ? { signal } : {}),
	}));
	return { owner, store, descriptors, request };
}

for (const kind of ['audio', 'video', 'archive'] as const) {
	test(`${kind} ranges queue overlapping reads until the active body completes`, async (context) => {
		const { request } = await fixture(context, kind);
		const first = await request();
		const second = request();
		assert.equal(await remainsPending(second), true);
		assert.deepEqual(new Uint8Array(await first.arrayBuffer()), Uint8Array.of(1, 2, 3, 4));
		const next = await second;
		assert.equal(next.status, 206);
		assert.deepEqual(new Uint8Array(await next.arrayBuffer()), Uint8Array.of(1, 2, 3, 4));
	});
}

test('separate project archives share the desktop range queue', async (context) => {
	const { request } = await fixture(context, 'archive', 2);
	const first = await request(0);
	const second = request(1);
	assert.equal(await remainsPending(second), true);
	await first.arrayBuffer();
	const next = await second;
	assert.equal(next.status, 206);
	await next.arrayBuffer();
});

test('linked media waits when the sixteen-request pool is occupied', async (context) => {
	const { request } = await fixture(context, 'audio', 17);
	const active = await Promise.all(Array.from({ length: 16 }, (_, index) => request(index)));
	const queued = request(16);
	assert.equal(await remainsPending(queued), true);
	await active[0]!.arrayBuffer();
	const next = await queued;
	assert.equal(next.status, 206);
	await Promise.all([...active.slice(1), next].map((response) => response.arrayBuffer()));
});

test('releasing a queued capability settles it while unrelated archive reads remain active', async (context) => {
	const { store, descriptors, owner } = await fixture(context, 'archive', 2);
	const first = store.acquireRequest(descriptors[0]!.id, descriptors[0]!.readProfile);
	assert.ok(first);
	const queued = store.acquireQueuedRequest(descriptors[1]!.id, descriptors[1]!.readProfile, new AbortController().signal);
	await store.release(descriptors[1]!.id, { owner });
	assert.equal(await remainsPending(queued), false);
	assert.equal(await queued, null);
	await first.close();
});

test('the desktop read queue bounds pending requests and cancelled waiters return their places', async (context) => {
	const { store, descriptors } = await fixture(context, 'archive');
	const descriptor = descriptors[0]!;
	const active = store.acquireRequest(descriptor.id, descriptor.readProfile);
	assert.ok(active);
	const controller = new AbortController();
	const queued = Array.from({ length: MAX_READ_CAPABILITIES_PER_OWNER }, () =>
		store.acquireQueuedRequest(descriptor.id, descriptor.readProfile, controller.signal));
	const settled = Promise.allSettled(queued);
	const overflowController = new AbortController();
	const overflow = store.acquireQueuedRequest(descriptor.id, descriptor.readProfile, overflowController.signal);
	assert.equal(await remainsPending(overflow), false);
	await assert.rejects(overflow, /queue.*limit|queue.*full/iu);
	controller.abort(new DOMException('Obsolete read', 'AbortError'));
	assert.equal((await settled).every(({ status }) => status === 'rejected'), true);
	const replacement = store.acquireQueuedRequest(descriptor.id, descriptor.readProfile, new AbortController().signal);
	await active.close();
	const next = await replacement;
	assert.ok(next);
	await next.close();
});
