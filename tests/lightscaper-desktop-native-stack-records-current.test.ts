/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { readLightscaperNativeStackRowCurrentV1, readLightscaperNativeStackStateRowCurrentV1, readLightscaperNativeStackMemberRowCurrentV1 } from '../desktop/lightscaper-native-stack-records-current-v1.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoStackV1, PHOTO_STACK_LIMITS_V1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';

const photos = Array.from({ length: 5 }, (_, index) => nativePhotoCurrentV1(index));
const stack = normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id: 'stack', revision: 0,
	photoIds: photos.slice(0, 3).map(photo => photo.id), coverPhotoId: photos[1]!.id });
function stackRow(value = stack, changed: Record<string, unknown> = {}) { return { stack_key: `catalog|${value.id}`, catalog_id: 'catalog', stack_id: value.id,
	revision: value.revision, document: JSON.stringify(value), photo_count: value.photoIds.length, cover_photo_id: value.coverPhotoId, ...changed }; }
const memberRow = (changes: Record<string, unknown> = {}) => ({ photo_key: `catalog|${photos[0]!.id}`, catalog_id: 'catalog', photo_id: photos[0]!.id,
	stack_key: 'catalog|stack', stack_id: 'stack', member_position: 0, ...changes });
function withDatabase(operation: (database: DatabaseSync) => void): void {
	const database = new DatabaseSync(':memory:', { allowExtension: false, enableDoubleQuotedStringLiterals: false });
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); const root = nativeCatalogRootCurrentV1();
		database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(root.id, serializeLightscaperDocumentV1({ ...root, photoCount: photos.length }), 0, photos.length, 0);
		for (const photo of photos) database.prepare('INSERT INTO native_photos VALUES (?,?,?,?,?,?)').run(photoStorageKey(photo.catalogId, photo.id), photo.catalogId, photo.id,
			photo.revision, serializePhotoDocumentCurrentV1(photo), JSON.stringify(photoSummary(photo)));
		operation(database);
	} finally { if (database.isTransaction) database.exec('ROLLBACK'); database.close(); }
}
function insertStack(database: DatabaseSync, row = stackRow()): void {
	database.prepare('INSERT INTO native_photo_stacks(stack_key,catalog_id,stack_id,revision,document,photo_count,cover_photo_id) VALUES (?,?,?,?,?,?,?)')
		.run(row.stack_key, row.catalog_id, row.stack_id, row.revision, row.document, row.photo_count, row.cover_photo_id);
}
const forward = (database: DatabaseSync) => database.prepare('SELECT photo_key,catalog_id,photo_id,stack_key,stack_id,member_position FROM native_photo_stack_forward_members ORDER BY stack_key,member_position').all();

test('Lightscaper native stack reader authenticates exact document, key, revision, count and cover projections', () => {
	assert.deepEqual(readLightscaperNativeStackRowCurrentV1(stackRow(), 'catalog', 'stack'), stack);
	for (const change of [{ stack_key: 'catalog|wrong' }, { catalog_id: 'other' }, { stack_id: 'wrong' }, { revision: 1 }, { photo_count: 2 },
		{ cover_photo_id: photos[0]!.id }, { extra: true }, { document: '{broken' }, { document: JSON.stringify({ ...stack, schemaVersion: 2 }) }]) {
		assert.throws(() => readLightscaperNativeStackRowCurrentV1(stackRow(stack, change)));
	}
	assert.throws(() => readLightscaperNativeStackRowCurrentV1(stackRow(), 'other')); assert.throws(() => readLightscaperNativeStackRowCurrentV1(stackRow(), 'catalog', 'other'));
	let invoked = false; const accessor = stackRow(); Object.defineProperty(accessor, 'document', { enumerable: true, get() { invoked = true; return ''; } });
	assert.throws(() => readLightscaperNativeStackRowCurrentV1(accessor)); assert.equal(invoked, false);
	assert.throws(() => readLightscaperNativeStackRowCurrentV1(stackRow(stack, { document: 'ä'.repeat(PHOTO_STACK_LIMITS_V1.maximumDocumentBytes) })), RangeError);
});

test('Lightscaper native stack state reader retains global revisions and admits only exact nonnegative safe scalar fields', () => {
	assert.deepEqual(readLightscaperNativeStackStateRowCurrentV1({ catalog_id: 'catalog', revision: 5, stack_count: 0 }, 'catalog'),
		{ schemaVersion: 1, kind: 'photo-stack-state', catalogId: 'catalog', revision: 5, stackCount: 0 });
	for (const change of [{ catalog_id: 'other' }, { revision: -1 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { stack_count: -1 }, { stack_count: 1.5 }, { extra: 0 }]) {
		assert.throws(() => readLightscaperNativeStackStateRowCurrentV1({ catalog_id: 'catalog', revision: 5, stack_count: 0, ...change }, 'catalog'));
	}
});

test('Lightscaper native stack member reader binds exact photo and stack scoped keys and zero-based position', () => {
	assert.deepEqual(readLightscaperNativeStackMemberRowCurrentV1(memberRow(), 'catalog'), { photoKey: `catalog|${photos[0]!.id}`, catalogId: 'catalog',
		photoId: photos[0]!.id, stackKey: 'catalog|stack', stackId: 'stack', memberPosition: 0 });
	assert.equal(readLightscaperNativeStackMemberRowCurrentV1(memberRow({ member_position: 1023 })).memberPosition, 1023);
	for (const change of [{ photo_key: 'catalog|wrong' }, { catalog_id: 'other' }, { photo_id: 'wrong' }, { stack_key: 'catalog|wrong' },
		{ stack_id: 'wrong' }, { member_position: -1 }, { member_position: 1024 }, { member_position: 0.5 }, { extra: true }]) {
		assert.throws(() => readLightscaperNativeStackMemberRowCurrentV1(memberRow(change), 'catalog'));
	}
});

test('Lightscaper native stack triggers create ordered forward rows independently of reverse membership and regenerate on update', () => {
	withDatabase(database => {
		insertStack(database); assert.equal(forward(database).length, 3);
		assert.deepEqual(forward(database).map(row => ({ ...row })), stack.photoIds.map((photoId, member_position) => ({ photo_key: `catalog|${photoId}`, catalog_id: 'catalog',
			photo_id: photoId, stack_key: 'catalog|stack', stack_id: 'stack', member_position })));
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_stack_memberships').get()?.count, 0);
		database.prepare('INSERT INTO native_photo_stack_memberships VALUES (?,?,?,?,?,?)').run(`catalog|${photos[0]!.id}`, 'catalog', photos[0]!.id, 'catalog|stack', 'stack', 0);
		const changed = normalizePhotoStackV1({ ...stack, revision: 1, photoIds: [...stack.photoIds].reverse() });
		database.prepare('UPDATE native_photo_stacks SET revision=?,document=? WHERE stack_key=?').run(changed.revision, JSON.stringify(changed), 'catalog|stack');
		assert.deepEqual(forward(database).map(row => row.photo_id), changed.photoIds);
		assert.equal(database.prepare('SELECT member_position FROM native_photo_stack_memberships').get()?.member_position, 0);
		assert.throws(() => database.prepare('UPDATE native_photo_stacks SET stack_key=?,stack_id=?,document=?').run('catalog|renamed', 'renamed', JSON.stringify({ ...changed, id: 'renamed' })));
		database.prepare('DELETE FROM native_photo_stacks WHERE stack_key=?').run('catalog|stack');
		assert.equal(forward(database).length, 0); assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_stack_memberships').get()?.count, 0);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photos').get()?.count, 5);
	});
});

test('Lightscaper native stack trigger uniqueness rejects overlap and rolls back failed regeneration without losing old forward custody', () => {
	withDatabase(database => {
		insertStack(database); const before = forward(database);
		const overlap = normalizePhotoStackV1({ ...stack, id: 'overlap', photoIds: [photos[2]!.id, photos[3]!.id], coverPhotoId: photos[2]!.id });
		assert.throws(() => insertStack(database, stackRow(overlap))); assert.deepEqual(forward(database), before);
		const other = normalizePhotoStackV1({ ...stack, id: 'other', photoIds: [photos[3]!.id, photos[4]!.id], coverPhotoId: photos[3]!.id }); insertStack(database, stackRow(other));
		const allBefore = forward(database), changed = { ...stack, revision: 1, photoIds: [photos[0]!.id, photos[3]!.id], coverPhotoId: photos[0]!.id };
		assert.throws(() => database.prepare('UPDATE native_photo_stacks SET revision=?,document=?,photo_count=?,cover_photo_id=? WHERE stack_key=?')
			.run(1, JSON.stringify(changed), 2, changed.coverPhotoId, 'catalog|stack'));
		assert.deepEqual(forward(database), allBefore); assert.deepEqual(readLightscaperNativeStackRowCurrentV1(database.prepare('SELECT * FROM native_photo_stacks WHERE stack_key=?').get('catalog|stack')), stack);
	});
});

test('Lightscaper native stack SQL guards reject forged document scalars, missing source photos, duplicate or nontext members', () => {
	withDatabase(database => {
		for (const change of [{ revision: 1 }, { photo_count: 2 }, { cover_photo_id: photos[0]!.id },
			{ document: JSON.stringify({ ...stack, schemaVersion: 2 }) }, { document: JSON.stringify({ ...stack, kind: 'foreign' }) },
			{ document: JSON.stringify({ ...stack, id: 'wrong' }) }, { document: JSON.stringify({ ...stack, catalogId: 'wrong' }) },
			{ document: JSON.stringify({ ...stack, photoIds: [stack.photoIds[0], stack.photoIds[0], stack.photoIds[1]] }) },
			{ document: JSON.stringify({ ...stack, photoIds: [stack.photoIds[0], 1, stack.photoIds[1]] }) },
			{ document: JSON.stringify({ ...stack, photoIds: [stack.photoIds[0], 'missing', stack.photoIds[1]] }) },
			{ cover_photo_id: 'missing', document: JSON.stringify({ ...stack, coverPhotoId: 'missing' }) },
			{ document: ' '.repeat(PHOTO_STACK_LIMITS_V1.maximumDocumentBytes + 1) }]) {
			assert.throws(() => insertStack(database, stackRow(stack, change))); assert.equal(forward(database).length, 0);
			assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_stacks').get()?.count, 0);
		}
		insertStack(database);
		for (const values of [[`catalog|${photos[0]!.id}`, 'catalog', photos[0]!.id, 'catalog|wrong', 'wrong', 0],
			[`catalog|${photos[0]!.id}`, 'catalog', photos[0]!.id, 'catalog|stack', 'stack', 1024],
			['other|photo', 'other', 'photo', 'catalog|stack', 'stack', 0]]) {
			assert.throws(() => database.prepare('INSERT INTO native_photo_stack_memberships VALUES (?,?,?,?,?,?)').run(...values));
		}
	});
});
