/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLightscaperPreloadBridgeCurrentV1 as create } from '../desktop/lightscaper-preload-bridge-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_RESTORE_CHANNELS_CURRENT_V1 as RESTORE } from '../src/lightscaper/desktop-photo-library-restore-contract-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as SESSION } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { captureDesktopPhotoBackendPortsCurrentV1 as capture } from '../src/lightscaper/desktop-photo-library-backend-current-v1.ts';

void test('Actual shell preload installs a complete cold native Session and restore pair with separate closed channels', async () => {
	let calls = 0, subscriptions = 0, reflections = 0;
	const api = create({ invoke: async (_channel, packet) => { calls++; return { schemaVersion: 1, ok: true, value: structuredClone(packet) }; },
		on: () => { subscriptions++; }, removeListener: () => undefined });
	const ports = capture({ v1: api }); assert.ok(ports);
	assert.equal(calls, 0); assert.equal(subscriptions, 0);
	const poison = new Proxy({}, { ownKeys() { reflections++; throw new Error('Unsupported packet must stay unread.'); }, get() { reflections++; throw new Error('Unsupported packet must stay unread.'); } });
	await assert.rejects(ports.restore.invoke(SESSION.catalog, poison), TypeError);
	await assert.rejects(ports.session.invoke(RESTORE.begin, poison), TypeError);
	await assert.rejects(ports.restore.invoke('arbitrary:filesystem', poison), TypeError);
	assert.equal(calls, 0); assert.equal(reflections, 0);
	assert.deepEqual(await ports.restore.invoke(RESTORE.begin, { name: 'Owned archive', byteLength: 7 }), { name: 'Owned archive', byteLength: 7 });
	assert.equal(calls, 1); assert.equal(subscriptions, 0);
});

void test('Installed restore preload decodes the bounded native error response before exposing it', async () => {
	const api = create({ invoke: async () => ({ schemaVersion: 1, ok: false, error: { name: 'RangeError', message: 'Archive exceeds its bound.' } }),
		on: () => undefined, removeListener: () => undefined });
	const ports = capture({ v1: api }); assert.ok(ports);
	await assert.rejects(ports.restore.invoke(RESTORE.begin, { name: 'Owned archive', byteLength: 7 }), RangeError);
});
