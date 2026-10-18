/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1, LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1,
	readLightscaperNativeOriginalCurrentV1, readLightscaperNativeOriginalStorageKeyCurrentV1 } from '../desktop/lightscaper-native-original-contract-current-v1.ts';

function original(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { schemaVersion: 1, kind: 'still', id: 'source-1', name: 'Night e\u0301 Ω.dng', mimeType: 'image/x-adobe-dng',
		storageKey: 'original:1', contentSha256: 'a'.repeat(64), width: 2, height: 1, hasAlpha: false,
		byteLength: 3, retention: 'managed', ...overrides };
}

test('Lightscaper native managed Original contract preserves the exact existing descriptor and detached name', () => {
	const input = original(), value = readLightscaperNativeOriginalCurrentV1(input);
	assert.deepEqual(value, input); assert.ok(Object.isFrozen(value));
	input.name = 'Changed'; input.byteLength = 4;
	assert.equal(value.name, 'Night e\u0301 Ω.dng'); assert.equal(value.byteLength, 3);
	assert.equal(LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1, 1024 * 1024);
});

test('Lightscaper native storage bounds support current HDR bytes without claiming decoder admission', () => {
	assert.equal(LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1, 196 * 1024 * 1024);
	for (const mimeType of ['image/png', 'image/x-adobe-dng', 'image/x-canon-crw', 'image/x-lightscaper-hdr']) {
		const value = readLightscaperNativeOriginalCurrentV1(original({ mimeType, byteLength: LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 }));
		assert.equal(value.byteLength, LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1);
	}
	for (const byteLength of [0, -1, 0.5, NaN, Infinity, LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 + 1]) {
		assert.throws(() => readLightscaperNativeOriginalCurrentV1(original({ byteLength })));
	}
});

test('Lightscaper native Original contract refuses linked retention and altered immutable scalar schemas', () => {
	for (const changed of [{ retention: 'linked' }, { retention: 'temporary' }, { contentSha256: null },
		{ contentSha256: 'A'.repeat(64) }, { contentSha256: 'a'.repeat(63) }, { mimeType: 'video/mp4' },
		{ schemaVersion: 2 }, { kind: 'file' }, { width: 0 }, { hasAlpha: 1 }, { path: '/tmp/original' }]) {
		assert.throws(() => readLightscaperNativeOriginalCurrentV1(original(changed)));
	}
});

test('Lightscaper native Original contract rejects getters, inherited fields and extension authority without invoking them', () => {
	let invoked = false;
	const getter = original(); Object.defineProperty(getter, 'name', { enumerable: true, get() { invoked = true; return 'Injected'; } });
	assert.throws(() => readLightscaperNativeOriginalCurrentV1(getter)); assert.equal(invoked, false);
	assert.throws(() => readLightscaperNativeOriginalCurrentV1(Object.create(original()) as unknown));
	const symbol = original(); Object.defineProperty(symbol, Symbol('path'), { value: '/tmp/file' });
	assert.throws(() => readLightscaperNativeOriginalCurrentV1(symbol));
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	assert.throws(() => readLightscaperNativeOriginalCurrentV1(revoked.proxy));
});

test('Lightscaper native Original storage keys reuse stable opaque identifiers and never admit paths', () => {
	for (const key of ['original:1', 'photo-original_1', 'a'.repeat(128)]) assert.equal(readLightscaperNativeOriginalStorageKeyCurrentV1(key), key);
	for (const key of ['', ' original', 'a'.repeat(129), '../file', '/tmp/file', 'C:\\photo.raw', 'https://example.test/file', 'name\0']) {
		assert.throws(() => readLightscaperNativeOriginalStorageKeyCurrentV1(key));
	}
});
