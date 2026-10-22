/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readDesktopPhotoLibrarySessionPacketCurrentV1 as packet } from '../src/lightscaper/desktop-photo-library-session-packets-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';

const value = (bytes: unknown) => ({ operation: 'write', handle: { kind: 'upload', id: 'a'.repeat(64) }, sequence: 0, offset: 0, bytes });
void test('Shared upload admission refuses overbound chunks before cloning their whole body', { timeout: 15_000 }, () => {
	assert.throws(() => packet(channels.upload, value(new Uint8Array(1_048_577)), 'catalog'), RangeError);
	assert.throws(() => packet(channels.upload, value(new Uint8Array(0)), 'catalog'), RangeError);
	assert.throws(() => packet(channels.upload, value(new Uint8Array(new SharedArrayBuffer(1))), 'catalog'));
	const resizable: ArrayBuffer = Reflect.construct(ArrayBuffer, [1, { maxByteLength: 2 }]) as ArrayBuffer;
	assert.throws(() => packet(channels.upload, value(new Uint8Array(resizable)), 'catalog'));
	const source = new Uint8Array([1, 2]), captured = packet(channels.upload, value(source), 'catalog');
	assert.ok(captured.bytes instanceof Uint8Array); source[0] = 9;
	assert.equal(captured.bytes.byteLength, 2); assert.equal(captured.bytes[0], 1);
});
