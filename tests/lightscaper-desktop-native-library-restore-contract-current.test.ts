/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readDesktopPhotoLibraryRestoreBeginCurrentV1 as begin, readDesktopPhotoLibraryRestoreWriteCurrentV1 as write,
	readDesktopPhotoLibraryRestoreCommitCurrentV1 as commit, readDesktopPhotoLibraryRestoreAbortCurrentV1 as abort,
	readDesktopPhotoLibraryRestoreReceiptCurrentV1 as receipt } from '../src/lightscaper/desktop-photo-library-restore-contract-current-v1.ts';
void test('Native restore closed wire shapes use the archive cap and own copied bounded chunks', () => {
	assert.equal(begin({ name: 'Native', byteLength: 200 * 1024 * 1024 }).byteLength, 200 * 1024 * 1024);
	assert.throws(() => begin({ name: 'Native', byteLength: 3, path: '/foreign' }));
	const bytes = Uint8Array.of(1,2,3), captured = write({ id: 'a'.repeat(64), offset: 0, bytes }); bytes.fill(0); assert.equal(captured.bytes[0], 1);
	assert.throws(() => write({ id: 'a'.repeat(64), offset: 0, bytes: new Uint8Array(1_048_577) }));
	assert.throws(() => write({ id: 'a'.repeat(64), offset: -0, bytes: Uint8Array.of(1) }));
	assert.throws(() => commit({ id: 'a'.repeat(64), contentSha256: 'A'.repeat(64) }));
	assert.equal(abort({ id: 'a'.repeat(64) }).id, 'a'.repeat(64)); assert.throws(() => abort({ id: 'a'.repeat(64), signal: new AbortController().signal }));
});
void test('Native restore receipt remains a closed truthful owning profile', () => {
	const value = { catalogId: 'catalog', catalogName: 'Library', photoCount: 1, stackCount: 0, savedCollectionCount: 0, originalCount: 1, originalByteLength: 3, notices: ['cleanup-failed'] };
	assert.equal(receipt(value).photoCount, 1); assert.throws(() => receipt({ ...value, notices: ['made-up'] })); assert.throws(() => receipt({ ...value, path: '/foreign' }));
});
