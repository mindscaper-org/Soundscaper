/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import test from 'node:test';
import { createLightscaperNativeSmartCollectionRestoreStageCurrentV1 as create } from '../desktop/lightscaper-native-smart-collection-restore-stage-current-v1.ts';
import { createLightscaperNativeSmartCollectionRestoreCandidateCurrentV1 as fresh } from '../desktop/lightscaper-native-smart-collection-restore-candidate-current-v1.ts';
import { seedNativeSmartCollectionFixtureCurrentV1 as seed, nativeSmartCollectionDefinitionFixtureCurrentV1 as definition } from './helpers/lightscaper-native-smart-collection-fixture-current.ts';
import { nativeStackQueryFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-stack-query-fixture-current.ts';
import type { PhotoSmartCollectionArchiveContextV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';

function context(count: number, revision: number | null = count ? 7 : null): PhotoSmartCollectionArchiveContextV1 {
	return { schemaVersion: 1, kind: 'photo-smart-collection-archive-context', catalogId: 'catalog', catalogRevision: 3, indexRevision: 11,
		state: revision === null ? null : { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision, collectionCount: count } };
}
for (const revision of [null, 0, 9]) test(`Lightscaper native private saved restore preserves exact ${String(revision)} physical state in an owned fresh candidate`, async () => {
	await fixture(async (active, path) => {
		const source = seed(active), candidate = await fresh(dirname(path), source.root, 11), stage = create(candidate.permit, context(0, revision));
		try {
			const receipt = await stage.finish(); assert.equal(receipt.definitionCount, 0); assert.deepEqual(receipt.context, context(0, revision));
			const row = candidate.database.prepare('SELECT revision,collection_count FROM native_photo_smart_collection_states').get();
			assert.equal(row?.revision ?? null, revision); assert.throws(() => stage.append([])); await assert.rejects(stage.finish());
		} finally { await candidate.close(); assert.equal(candidate.close(), candidate.close()); }
		await assert.rejects(access(candidate.directory), { code: 'ENOENT' });
	});
});

test('Lightscaper native private saved restore uses70 canonical records in64+6 packs and leaves active SQLite untouched', async () => {
	await fixture(async (active, path) => {
		const before = seed(active, 1), candidate = await fresh(dirname(path), before.root, 11), stage = create(candidate.permit, context(70));
		try {
			const definitions = Array.from({ length: 70 }, (_, i) => definition(i)); stage.append(definitions.slice(0, 64)); stage.append(definitions.slice(64));
			assert.equal(candidate.database.isTransaction, false); const receipt = await stage.finish(); assert.equal(receipt.definitionCount, 70); assert.match(receipt.inventorySha256, /^[a-f0-9]{64}$/u);
			assert.equal(active.prepare('SELECT document FROM native_photo_smart_collections').get()?.document, JSON.stringify(before.definitions[0]));
			assert.equal(active.prepare('SELECT collection_count FROM native_photo_smart_collection_states').get()?.collection_count, 1);
		} finally { await candidate.close(); }
	});
});

test('Lightscaper native private saved restore rejects arbitrary active-empty and forged permits before any mutation', async () => {
	await fixture(async (active, path) => {
		const before = seed(active), original = active.prepare('SELECT document,index_revision FROM native_photo_catalogs').get();
		assert.throws(() => create(active as never, context(0))); assert.throws(() => create({} as never, context(0)));
		assert.deepEqual(active.prepare('SELECT document,index_revision FROM native_photo_catalogs').get(), original);
		assert.equal(active.prepare('SELECT catalog_id FROM native_photo_smart_collection_states').get(), undefined);
		const candidate = await fresh(dirname(path), before.root, 11);
		try { assert.throws(() => create({ ...candidate.permit } as never, context(0))); create(candidate.permit, context(0)); assert.throws(() => create(candidate.permit, context(0))); }
		finally { await candidate.close(); }
	});
});

test('Lightscaper native private saved restore rolls back an entire pack when a later recipe has invalid hidden references', async () => {
	await fixture(async (active, path) => {
		const source = seed(active), candidate = await fresh(dirname(path), source.root, 11), stage = create(candidate.permit, context(2));
		try {
			const invalid = { ...definition(1), query: { ...definition(1).query, predicate: { kind: 'not', term: { kind: 'keyword', id: 'missing' } } } };
			assert.throws(() => stage.append([definition(0), invalid])); assert.equal(candidate.database.prepare('SELECT collection_key FROM native_photo_smart_collections LIMIT 1').get(), undefined);
			assert.equal(candidate.database.isTransaction, false); stage.append([definition(0), definition(1)]); assert.equal((await stage.finish()).definitionCount, 2);
		} finally { await candidate.close(); }
	});
});

test('Lightscaper native private saved restore refuses incomplete recipes, over64 packs, duplicates, ordering and incomplete count', async () => {
	await fixture(async (active, path) => {
		const source = seed(active), candidate = await fresh(dirname(path), source.root, 11), stage = create(candidate.permit, context(2));
		try {
			assert.throws(() => stage.append([{ ...definition(0), query: { schemaVersion: 2, kind: 'photo-catalog-query' } }]));
			assert.throws(() => stage.append(Array.from({ length: 65 }, (_, i) => definition(i)))); stage.append([definition(0)]);
			assert.throws(() => stage.append([definition(0)])); assert.throws(() => stage.append([definition(2), definition(1)])); await assert.rejects(stage.finish(), /count|incomplete/iu);
		} finally { await candidate.close(); }
	});
});

test('Lightscaper native private saved restore final audit refuses same-revision mutation before ready receipt', async () => {
	await fixture(async (active, path) => {
		const source = seed(active), candidate = await fresh(dirname(path), source.root, 11), stage = create(candidate.permit, context(1));
		try {
			stage.append([definition(0)]); const changed = { ...definition(0), name: 'Different bytes' };
			candidate.database.prepare('UPDATE native_photo_smart_collections SET document=?').run(JSON.stringify(changed));
			candidate.database.prepare('UPDATE native_photo_smart_collection_summaries SET name=?').run(JSON.stringify(changed.name));
			await assert.rejects(stage.finish(), /digest|inventory|changed/iu);
		} finally { await candidate.close(); }
	});
});

test('Lightscaper native private saved restore reserves its permit before Proxy capture can request candidate close', async () => {
	await fixture(async (active, path) => {
		const source = seed(active), candidate = await fresh(dirname(path), source.root, 11); let closing: Promise<void> | undefined, attempts = 0;
		const borrowed = new Proxy(context(0), { ownKeys(target) { attempts++; closing = candidate.close(); return Reflect.ownKeys(target); } });
		assert.throws(() => create(candidate.permit, borrowed)); assert.ok(closing); await closing; assert.ok(attempts > 0);
		assert.throws(() => create(candidate.permit, context(0))); await assert.rejects(access(candidate.directory), { code: 'ENOENT' });
	});
});

test('Lightscaper native private saved restore candidate closes and joins a pending final audit, retaining no owned files', async () => {
	await fixture(async (active, path) => {
		const source = seed(active), candidate = await fresh(dirname(path), source.root, 11), stage = create(candidate.permit, context(70));
		stage.append(Array.from({ length: 64 }, (_, i) => definition(i))); stage.append(Array.from({ length: 6 }, (_, i) => definition(64 + i)));
		const finished = stage.finish(), rejected = finished.then(() => assert.fail('Owned shutdown must abort finish before initialization'), () => undefined), closing = candidate.close();
		await rejected; await closing; assert.equal(candidate.close(), closing); await assert.rejects(access(candidate.directory), { code: 'ENOENT' });
	});
});

test('Lightscaper native private saved restore candidate snapshots root before await and creates nothing for pre-aborted requests', async () => {
	await fixture(async (active, path) => {
		const source = seed(active), root = { ...source.root, name: 'Captured root' }, parent = dirname(path), before = await readdir(parent), stop = new AbortController(); stop.abort('stop');
		await assert.rejects(fresh(parent, root, 11, { signal: stop.signal })); assert.deepEqual(await readdir(parent), before);
		const pending = fresh(parent, root, 11); root.name = 'Borrowed mutation'; const candidate = await pending;
		try { assert.equal(JSON.parse(candidate.database.prepare('SELECT document FROM native_photo_catalogs').get()?.document as string).name, 'Captured root'); }
		finally { await candidate.close(); }
	});
});
