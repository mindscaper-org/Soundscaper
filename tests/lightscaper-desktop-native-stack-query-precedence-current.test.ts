/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readLightscaperNativeStackQueryPageCurrentV1 as read } from '../desktop/lightscaper-native-stack-query-current-v1.ts';
import { captureLightscaperNativeStackContextCurrentV1 as captureFull } from '../desktop/lightscaper-native-stack-auth-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 as json } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { nativeStackQueryFixtureCurrentV1 as fixture, seedNativeStackQueryCurrentV1 as seed,
	CATALOG } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

for (const stale of ['root', 'index', 'state'] as const) for (const build of ['missing', 'unready'] as const) {
	test(`Lightscaper native collapsed Query2 reports stale ${stale} before ${build} readiness`, async () => {
		await fixture(database => {
			const f = seed(database, 65), first = read(database, CATALOG); assert.ok(first.continuation);
			if (stale === 'root') database.prepare('UPDATE native_photo_catalogs SET root_revision=4,document=? WHERE id=?').run(json({ ...f.root, revision: 4 }), CATALOG);
			if (stale === 'index') database.prepare('UPDATE native_photo_catalogs SET index_revision=12 WHERE id=?').run(CATALOG);
			if (stale === 'state') database.prepare('UPDATE native_photo_stack_states SET revision=6 WHERE catalog_id=?').run(CATALOG);
			if (build === 'missing') database.prepare('DELETE FROM native_photo_query_builds_v2 WHERE catalog_id=?').run(CATALOG);
			else database.prepare('UPDATE native_photo_query_builds_v2 SET ready=0 WHERE catalog_id=?').run(CATALOG);
			assert.throws(() => read(database, CATALOG, { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
			assert.equal(database.isTransaction, false);
		});
	});
}
for (const build of ['missing', 'unready'] as const) {
	test(`Lightscaper native collapsed Query2 current progress reports its ${build} query index`, async () => {
		await fixture(database => {
			seed(database, 65); const first = read(database, CATALOG); assert.ok(first.continuation);
			if (build === 'missing') database.prepare('DELETE FROM native_photo_query_builds_v2 WHERE catalog_id=?').run(CATALOG);
			else database.prepare('UPDATE native_photo_query_builds_v2 SET ready=0 WHERE catalog_id=?').run(CATALOG);
			assert.throws(() => read(database, CATALOG, { continuation: first.continuation }), { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
			assert.equal(database.isTransaction, false);
		});
	});
}

test('Lightscaper native E76 full context retains its query-preflight-before-state refusal order', async () => {
	await fixture(database => {
		seed(database, 2); database.exec('DELETE FROM native_photo_query_builds_v2; DELETE FROM native_photo_stack_states');
		database.exec('BEGIN');
		try { assert.throws(() => captureFull(database, CATALOG), /Query2 build count/iu); }
		finally { database.exec('ROLLBACK'); }
	});
});
