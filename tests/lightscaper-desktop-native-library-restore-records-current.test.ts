/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLightscaperNativePhotoLibraryRestoreReceiptCurrentV1 as read,
	type LightscaperNativePhotoLibraryRestoreReceiptCurrentV1 } from '../desktop/lightscaper-native-photo-library-restore-records-current-v1.ts';

const allocation = { schemaVersion: 1, kind: 'photo-library-restore-allocation', operationId: 'a'.repeat(32),
	namespaceToken: 'a'.repeat(32), ownerToken: 'b'.repeat(32), catalogId: 'restored-catalog' };
const receipt = (): LightscaperNativePhotoLibraryRestoreReceiptCurrentV1 => ({ schemaVersion: 1, kind: 'native-photo-library-restore-ready',
	catalogId: allocation.catalogId, catalogRevision: 41, photoCount: 6, stackCount: 2, savedCollectionCount: 3, indexRevision: 0,
	originalCount: 3, originalByteLength: 17, catalogInventorySha256: 'c'.repeat(64), mediaInventorySha256: 'd'.repeat(64) });

void test('Native restore scalar receipt retains exact restored epochs, complete inventory digests and counts without browser database names', () => {
	const input = receipt(), value = read(input, allocation);
	assert.deepEqual(value, input); assert.equal(Object.isFrozen(value), true); assert.notEqual(value, input);
	assert.equal(Reflect.set(input, 'photoCount', 9), true); assert.equal(value.photoCount, 6);
	assert.equal(Object.hasOwn(value, 'catalogDatabaseName'), false); assert.equal(Object.hasOwn(value, 'mediaDatabaseName'), false);
});
void test('Native restore receipt accepts a genuinely empty scalar inventory without interpreting it as publication authority', () => {
	const empty = read({ ...receipt(), photoCount: 0, stackCount: 0, originalCount: 0, originalByteLength: 0 }, allocation);
	assert.equal(empty.photoCount, 0); assert.equal(empty.savedCollectionCount, 3); assert.equal(Object.keys(empty).length, 12);
});
void test('Native restore receipt refuses foreign allocation, browser profiles and augmented records', () => {
	assert.throws(() => read(receipt(), { ...allocation, catalogId: 'foreign-catalog' }));
	for (const patch of [{ kind: 'photo-library-restore-ready' }, { schemaVersion: 2 }, { catalogDatabaseName: 'browser-db' },
		{ mediaDatabaseName: 'browser-media' }, { path: '/untrusted' }, { ownerToken: allocation.ownerToken }]) {
		assert.throws(() => read({ ...receipt(), ...patch }, allocation));
	}
});
void test('Native restore receipt refuses noncanonical and inconsistent counters before any body allocation', () => {
	for (const key of ['catalogRevision', 'photoCount', 'stackCount', 'savedCollectionCount', 'indexRevision', 'originalCount', 'originalByteLength']) {
		for (const value of [-0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => read({ ...receipt(), [key]: value }, allocation));
	}
	for (const patch of [{ photoCount: 10_000_001 }, { stackCount: 7 }, { savedCollectionCount: 10_001 }, { indexRevision: 1 },
		{ originalCount: 7 }, { originalCount: 0 }, { originalByteLength: 0 }, { originalByteLength: 2 }, { photoCount: 0 },
		{ photoCount: 0, stackCount: 0, originalCount: 0, originalByteLength: 1 }]) assert.throws(() => read({ ...receipt(), ...patch }, allocation));
});
void test('Native restore receipt accepts bounded large counts arithmetically and requires complete lowercase SHA-256 inventories', () => {
	assert.equal(read({ ...receipt(), photoCount: 10_000_000, originalCount: 10_000_000, originalByteLength: Number.MAX_SAFE_INTEGER }, allocation).photoCount, 10_000_000);
	for (const key of ['catalogInventorySha256', 'mediaInventorySha256']) {
		for (const value of ['C'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), null, 3]) assert.throws(() => read({ ...receipt(), [key]: value }, allocation));
	}
});
void test('Native restore receipt refuses accessor authority without invoking getters', () => {
	let calls = 0; const value = Object.defineProperty({ ...receipt() }, 'photoCount', { enumerable: true, get() { calls++; throw new Error('Getter must remain untouched.'); } });
	assert.throws(() => read(value, allocation)); assert.equal(calls, 0);
});
