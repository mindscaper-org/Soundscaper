/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readLightscaperNativePhotoLibrarySelectionCurrentV1 as selection, readLightscaperNativePhotoLibraryCommitCurrentV1 as commit,
	lightscaperNativePhotoLibraryCommitKeyCurrentV1 as commitKey, LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_SELECTION_KEY_CURRENT_V1 as POINTER,
	LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_ACTIVE_RESTORE_KEY_CURRENT_V1 as ACTIVE } from '../desktop/lightscaper-native-photo-library-selection-contract-current-v1.ts';
import { canonicalKeyValueComparison } from '../src/common/editor/storage/key-value-canonical-comparison.ts';

const before = { schemaVersion: 1, kind: 'native-photo-library-selection', selectionToken: 'a'.repeat(32), catalogId: 'same-catalog', namespaceToken: null };
const allocation = { schemaVersion: 1, kind: 'photo-library-restore-allocation', operationId: 'b'.repeat(32), namespaceToken: 'b'.repeat(32), ownerToken: 'c'.repeat(32), catalogId: 'same-catalog' };
const after = { ...before, selectionToken: 'd'.repeat(32), namespaceToken: allocation.namespaceToken };
const receipt = { schemaVersion: 1, kind: 'native-photo-library-restore-ready', catalogId: allocation.catalogId, catalogRevision: 29,
	photoCount: 3, stackCount: 1, savedCollectionCount: 1, indexRevision: 0, originalCount: 2, originalByteLength: 6,
	catalogInventorySha256: 'e'.repeat(64), mediaInventorySha256: 'f'.repeat(64) };
const value = () => ({ schemaVersion: 1, kind: 'native-photo-library-restore-commit', previous: before, replacement: after, allocation,
	registryOwner: '1'.repeat(32), manifestSha256: '2'.repeat(64), receipt });
void test('Lightscaper native selection keeps default/restored generations explicit and detached without browser names', () => {
	for (const input of [before, after]) { const result = selection(input); assert.deepEqual(result, input); assert.notEqual(result, input); assert.equal(Object.isFrozen(result), true); }
	assert.equal(POINTER, 'photo-library:native-selected-v1'); assert.equal(ACTIVE, 'photo-library:native-restore-active-v1');
	assert.equal(commitKey(allocation.namespaceToken), `photo-library:native-restore-commit-v1:${allocation.namespaceToken}`);
});
void test('Lightscaper native selection admission never mutates exact stored pointer order used by native CAS', () => {
	const input = { namespaceToken: null, catalogId: before.catalogId, selectionToken: before.selectionToken, kind: before.kind, schemaVersion: 1 };
	const exact = canonicalKeyValueComparison(input); assert.deepEqual(selection(input), before); assert.equal(canonicalKeyValueComparison(input), exact);
});
void test('Lightscaper native permanent commit admits complete same-catalog fresh generation plus native ready facts', () => {
	const result = commit(value()); assert.deepEqual(result, value()); assert.equal(Object.isFrozen(result), true);
	assert.notEqual(result.previous, before); assert.notEqual(result.receipt, receipt); assert.ok(new TextEncoder().encode(JSON.stringify(result)).length <= 4096);
});
for (const [label, patch] of [
	['selection token replay', { replacement: { ...after, selectionToken: before.selectionToken } }],
	['same namespace replay', { previous: { ...before, namespaceToken: allocation.namespaceToken } }],
	['foreign replacement catalog', { replacement: { ...after, catalogId: 'foreign' } }],
	['foreign replacement namespace', { replacement: { ...after, namespaceToken: '3'.repeat(32) } }],
	['foreign ready catalog', { receipt: { ...receipt, catalogId: 'foreign' } }],
	['browser ready receipt', { receipt: { ...receipt, kind: 'photo-library-restore-ready' } }],
	['nonzero ready index', { receipt: { ...receipt, indexRevision: 1 } }],
	['malformed owner', { registryOwner: 'x'.repeat(32) }],
	['malformed manifest digest', { manifestSha256: 'A'.repeat(64) }],
] as const) void test(`Lightscaper native commit refuses ${label}`, () => { assert.throws(() => commit({ ...value(), ...patch })); });
void test('Lightscaper native scalar selection rejects defaults, foreign versions and noninert records', () => {
	for (const input of [undefined, null, {}, { ...before, extra: true }, { ...before, namespaceToken: undefined }, { ...before, schemaVersion: 2 },
		{ ...before, selectionToken: before.selectionToken + '\n' }, { ...before, namespaceToken: 'A'.repeat(32) }, { ...before, catalogId: 'bad/path' },
		{ ...before, get selectionToken() { throw new Error('Getter must not run.'); } }]) assert.throws(() => selection(input));
	for (const token of [null, 4, 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(32) + '\n']) assert.throws(() => commitKey(token));
});
void test('Lightscaper native scalar commit rejects missing/extra/accessor fields without mutating supplied records', () => {
	const input = value(), original = JSON.stringify(input); assert.throws(() => commit({ ...input, extra: true }));
	assert.throws(() => commit({ ...input, get receipt() { throw new Error('Getter must not run.'); } }));
	assert.throws(() => commit({ ...input, receipt: undefined })); assert.equal(JSON.stringify(input), original);
});
void test('Lightscaper native scalar readers preserve opaque synchronous reflection refusal without then inspection', () => {
	const reason = Object.freeze(Object.defineProperty({}, 'then', { get() { throw new Error('Opaque reason inspected.'); } }));
	const input = new Proxy({}, { ownKeys() { throw reason; } });
	for (const read of [selection, commit]) { let failed = false; try { read(input); } catch (error) { failed = true; assert.equal(error, reason); } assert.equal(failed, true); }
});
