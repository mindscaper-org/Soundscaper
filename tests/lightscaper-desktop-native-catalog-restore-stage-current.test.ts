/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLightscaperNativeCatalogRestoreStageCurrentV1 as createStage,
	readLightscaperNativeCatalogRestoreReceiptCurrentV1 as readReceipt, readLightscaperNativeCatalogRestoreAuditCurrentV1 as audit } from '../desktop/lightscaper-native-catalog-restore-stage-current-v1.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoMemberships, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { catalogRestoreRecordsCurrentV1 as records, nativeCatalogRestoreFixtureCurrentV1 as fixture, fillCatalogRestoreCurrentV1 as fill } from './helpers/lightscaper-native-catalog-restore-fixture-current.ts';

void test('Lightscaper genuine native restore preserves whole mixed Photos and archived root, Stack and saved revisions', { timeout: 15_000 }, async context => fixture(context, async f => {
	const r = records(), state = { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: r.root.id, revision: 31, collectionCount: 1 };
	const { stage, candidate, database } = await f.create(r.root, state);
	assert.throws(() => audit(stage, candidate.allocation)); await fill(stage, r, true);
	const ready = await stage.finish(); assert.equal(readReceipt(ready, candidate.allocation), ready); assert.match(ready.inventorySha256, /^[a-f0-9]{64}$/u);
	assert.deepEqual({ ...ready, inventorySha256: null }, { catalogId: r.root.id, catalogRevision: 29, photoCount: 3, stackCount: 1, savedCollectionCount: 1, indexRevision: 0, inventorySha256: null });
	const root = database.prepare('SELECT document,index_revision FROM native_photo_catalogs').get()!; assert.deepEqual(JSON.parse(String(root.document)), r.root); assert.equal(root.index_revision, 0);
	for (const photo of r.photos) {
		const row = database.prepare('SELECT document,summary,revision FROM native_photos WHERE photo_id=?').get(photo.id)!;
		assert.deepEqual(JSON.parse(String(row.document)), photo); assert.deepEqual(JSON.parse(String(row.summary)), photoSummary(photo)); assert.equal(row.revision, photo.revision);
		for (const [table, expected] of [['native_photo_query_rows_v1', projectPhotoQueryRowV1(photo)], ['native_photo_query_rows_v2', projectPhotoQueryRowV2(photo)]] as const) {
			assert.deepEqual(JSON.parse(String(database.prepare(`SELECT row_json FROM ${table} WHERE photo_id=?`).get(photo.id)!.row_json)), expected);
		}
		assert.equal(database.prepare('SELECT COUNT(*) AS n FROM native_photo_memberships WHERE photo_key=?').get(`${photo.catalogId}|${photo.id}`)?.n, photoMemberships(photo).length);
	}
	assert.deepEqual({ ...database.prepare('SELECT revision,stack_count FROM native_photo_stack_states').get() }, { revision: 0, stack_count: 1 });
	assert.deepEqual({ ...database.prepare('SELECT revision,collection_count FROM native_photo_smart_collection_states').get() }, { revision: 31, collection_count: 1 });
	assert.deepEqual(JSON.parse(String(database.prepare('SELECT document FROM native_photo_stacks').get()!.document)), r.stack);
	assert.deepEqual(JSON.parse(String(database.prepare('SELECT document FROM native_photo_smart_collections').get()!.document)), r.saved);
	for (const table of ['native_photo_query_builds_v1', 'native_photo_query_builds_v2']) assert.deepEqual({ ...database.prepare(`SELECT ready,after_key,indexed_count FROM ${table}`).get() }, { ready: 1, after_key: null, indexed_count: 3 });
	const view = audit(stage, candidate.allocation); assert.equal(view.inventorySha256, ready.inventorySha256);
	const page = await view.readPhotoKeyPage(null); assert.equal(page.keys.length, 3); assert.equal(page.afterKey, null);
	assert.deepEqual(await view.readPhoto(r.photos[0]!.id), r.photos[0]);
	assert.throws(() => readReceipt(structuredClone(ready), candidate.allocation)); assert.throws(() => audit({ ...stage }, candidate.allocation));
	assert.throws(() => readReceipt(ready, { ...candidate.allocation, ownerToken: 'f'.repeat(32) }));
	await assert.rejects(stage.writePhoto(r.photos[0])); await stage.close(); assert.equal(readReceipt(ready, candidate.allocation), ready); assert.throws(() => audit(stage, candidate.allocation));
}));
for (const revision of [null, 0, 41]) void test(`Lightscaper native restore retains physical saved-state ${String(revision)}`, { timeout: 15_000 }, async context => fixture(context, async f => {
	const r = records(0), state = revision === null ? null : { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: r.root.id, revision, collectionCount: 0 };
	const { stage, database } = await f.create(r.root, state); const ready = await stage.finish(); assert.equal(ready.photoCount, 0);
	assert.equal(database.prepare('SELECT revision FROM native_photo_smart_collection_states').get()?.revision ?? null, revision);
}));
void test('Lightscaper native restore requires real unused purpose-bound fresh claims before root reflection', { timeout: 15_000 }, async context => fixture(context, async f => {
	let touched = false; const options = { get root() { touched = true; throw new Error('Borrowed root.'); }, savedState: null };
	await assert.rejects(createStage({}, options)); assert.equal(touched, false);
	const r = records(0), { candidate } = await f.create(r.root); await assert.rejects(createStage(candidate.catalogClaim, { root: r.root, savedState: null }));
	await assert.rejects(createStage(candidate.mediaClaim, { root: r.root, savedState: null }));
}));
void test('Lightscaper native restore sealed key pages are scalar bounded and resume after 64 rows', { timeout: 15_000 }, async context => fixture(context, async f => {
	const r = records(65), { stage, candidate } = await f.create(r.root); for (const photo of r.photos) await stage.writePhoto(photo); await stage.finish();
	const view = audit(stage, candidate.allocation), first = await view.readPhotoKeyPage(null), second = await view.readPhotoKeyPage(first.afterKey);
	assert.equal(first.keys.length, 64); assert.ok(first.afterKey); assert.equal(second.keys.length, 1); assert.equal(second.afterKey, null);
	assert.equal(new Set([...first.keys, ...second.keys].map(value => value.photoId)).size, 65);
	assert.ok(first.keys.every(value => Object.keys(value).join(',') === 'key,photoId'));
}));
