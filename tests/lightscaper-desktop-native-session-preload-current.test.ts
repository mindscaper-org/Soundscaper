/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLightscaperPreloadSessionCurrentV1 as create } from '../desktop/lightscaper-preload-session-current-v1.ts';
import { LightscaperNativePhotoSessionRetirementCurrentV1 as Retirement } from '../desktop/lightscaper-native-photo-session-retirement-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as CHANNELS } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { DESKTOP_PHOTO_SESSION_CONTROL_CHANNELS_CURRENT_V1 as CONTROL, captureDesktopPhotoSessionFailureCurrentV1 as captureFailure,
	readDesktopPhotoSessionResponseCurrentV1 as response } from '../src/lightscaper/desktop-photo-session-response-current-v1.ts';
import type { LightscaperPreloadIpcCurrentV1 as Ipc } from '../desktop/lightscaper-preload-bridge-current-v1.ts';
import { remainsPending } from './helpers/async-test-control.ts';

const options = { timeout: 15_000 }, openId = '3'.repeat(64);
function fixture() {
	const listeners = new Map<string, (event: unknown, value: unknown) => void>(); let calls = 0;
	const native = new Retirement(value => { listeners.get(CONTROL.requested)?.({}, structuredClone(value)); });
	const ipc: Ipc = {
		invoke(channel, ...args) { calls++; if (channel === CONTROL.completed) return Promise.resolve(native.respond(structuredClone(args[0])));
			return Promise.resolve({ schemaVersion: 1, ok: true, value: structuredClone(args[0]) }); },
		on(channel, listener) { assert.equal(listeners.has(channel), false); listeners.set(channel, listener); },
		removeListener(channel, listener) { assert.equal(listeners.get(channel), listener); listeners.delete(channel); },
	};
	return { native, client: create(ipc), listeners, calls: () => calls };
}

void test('Native preload joins captured actual local consumer before deriving private completion', options, async context => {
	const f = fixture(); let release!: () => void, localCloses = 0;
	const held = new Promise<void>(resolve => { release = resolve; }); context.signal.addEventListener('abort', release, { once: true });
	const detach = f.client.installRetirement(openId, () => { localCloses++; return held; }), owner = f.native.register(openId);
	let closing: Promise<void> | undefined;
	try {
		f.native.stop(); assert.equal(localCloses, 1);
		closing = owner.close(); assert.equal(owner.close(), closing); assert.equal(await remainsPending(closing), true); assert.equal(f.calls(), 0);
		detach(); assert.equal(f.listeners.has(CONTROL.requested), true, 'An accepted real local close retains its installed handler through completion.');
		release(); await closing; assert.equal(localCloses, 1); await Promise.resolve(); assert.equal(f.calls(), 1);
	} finally { release(); await closing; detach(); context.signal.removeEventListener('abort', release); }
});

void test('Native preload requires local registration before open and forbids arbitrary IPC channels', options, async () => {
	const f = fixture(); await assert.rejects(f.client.invoke(CHANNELS.open, { name: 'Native', openId }));
	await assert.rejects(f.client.invoke('arbitrary:filesystem', { path: '/private' })); assert.equal(f.calls(), 0);
	const detach = f.client.installRetirement(openId, () => Promise.resolve());
	try {
		assert.throws(() => f.client.installRetirement(openId, () => Promise.resolve()));
		await assert.rejects(f.client.invoke(CHANNELS.open, { name: 'Native', openId: '4'.repeat(64) })); assert.equal(f.calls(), 0);
		assert.deepEqual(await f.client.invoke(CHANNELS.open, { name: 'Native', openId }), { name: 'Native', openId });
	} finally { detach(); }
});

void test('Native local barrier refuses shell consent, forged nonce and unsolicited completion', options, async context => {
	const sent: unknown[] = [], native = new Retirement(value => { sent.push(value); }), owner = native.register(openId);
	assert.throws(() => native.respond({ allow: true })); const closing = owner.close(); void closing.catch(() => undefined);
	context.signal.addEventListener('abort', () => { native.confirmProcessExit(); }, { once: true });
	try {
		const request = sent[0] as Record<string, unknown>;
		assert.throws(() => native.respond({ ...request, kind: undefined, outcome: 'retired' }));
		assert.throws(() => native.respond({ schemaVersion: 1, openId, retirementId: '0'.repeat(64), outcome: 'retired' }));
		assert.equal(await remainsPending(closing), true);
		native.respond({ schemaVersion: 1, openId, retirementId: request.retirementId, outcome: 'retired' }); await closing;
	} finally { native.confirmProcessExit(); await closing; }
});

void test('Native preload forwards actual local failure without claiming successful retirement', options, async () => {
	const f = fixture(), failure = new TypeError('real local close failed');
	const detach = f.client.installRetirement(openId, () => Promise.reject(failure)), owner = f.native.register(openId);
	try {
		await assert.rejects(owner.close(), error => error instanceof TypeError && error.message === failure.message);
		assert.throws(() => f.native.register('4'.repeat(64))); assert.equal(f.calls(), 1);
	} finally { detach(); }
});

void test('Native local control fence is registered before reentrant actual Close invocation', options, async () => {
	const f = fixture(); let reentered: Promise<void> | undefined, calls = 0;
	const detach = f.client.installRetirement(openId, () => { calls++; reentered = owner.close(); return Promise.resolve(); }); const owner = f.native.register(openId);
	try { const closing = owner.close(); assert.equal(reentered, closing); await closing; assert.equal(calls, 1); } finally { detach(); }
});

void test('Native response wire retains bounded domain conflict facts and refuses mixed/opaque payloads', options, () => {
	const conflict = Object.assign(new Error('Reload the catalog.'), { name: 'PhotoCatalogRevisionConflictError', code: 'CATALOG_REVISION_CONFLICT' });
	assert.throws(() => response({ schemaVersion: 1, ok: false, error: captureFailure(conflict) }), error => error instanceof Error
		&& error.name === conflict.name && Reflect.get(error, 'code') === conflict.code);
	assert.deepEqual(captureFailure(Symbol('private Main reason')), { name: 'Error', message: 'Native Photo operation failed.' });
	assert.throws(() => response({ schemaVersion: 1, ok: true, value: 3, error: {} }));
	assert.throws(() => response({ schemaVersion: 1, ok: false, error: { name: 'Error', message: 'x'.repeat(2049) } }));
	assert.equal(response({ schemaVersion: 1, ok: true, value: undefined }), undefined);
});
