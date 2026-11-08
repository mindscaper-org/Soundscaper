/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { catalogRestoreRecordsCurrentV1 as records, nativeCatalogRestoreFixtureCurrentV1 as fixture, fillCatalogRestoreCurrentV1 as fill,
	assertOpaqueCatalogRestoreFailureCurrentV1 as opaque } from './helpers/lightscaper-native-catalog-restore-fixture-current.ts';

for (const mode of ['photo', 'summary', 'row1', 'row2', 'membership', 'forward', 'reverse', 'saved', 'saved-summary', 'extra'] as const) {
	void test(`Lightscaper native restore rejects actual persisted ${mode} corruption before readiness`, { timeout: 15_000 }, async context => fixture(context, async f => {
		const r = records(), state = { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: r.root.id, revision: 3, collectionCount: 1 };
		const { stage, database } = await f.create(r.root, state); await fill(stage, r, true);
		if (mode === 'photo') database.prepare("UPDATE native_photos SET document=json_set(document,'$.metadata.title','changed') WHERE photo_id=?").run(r.photos[0]!.id);
		else if (mode === 'summary') database.prepare("UPDATE native_photos SET summary=json_set(summary,'$.fileName','changed') WHERE photo_id=?").run(r.photos[0]!.id);
		else if (mode === 'row1' || mode === 'row2') database.exec(`DELETE FROM native_photo_query_rows_v${mode === 'row1' ? '1' : '2'} WHERE photo_key=(SELECT photo_key FROM native_photos LIMIT 1)`);
		else if (mode === 'membership') database.exec('DELETE FROM native_photo_memberships WHERE key=(SELECT key FROM native_photo_memberships LIMIT 1)');
		else if (mode === 'forward') database.exec('DELETE FROM native_photo_stack_forward_members WHERE member_position=0');
		else if (mode === 'reverse') database.exec('DELETE FROM native_photo_stack_memberships WHERE member_position=0');
		else if (mode === 'saved') database.exec("UPDATE native_photo_smart_collections SET document=json_set(document,'$.name','changed')");
		else if (mode === 'saved-summary') database.exec('DELETE FROM native_photo_smart_collection_summaries');
		else database.exec("INSERT INTO native_photo_catalogs VALUES('foreign','{}',0,0,0)");
		await assert.rejects(stage.finish()); assert.equal(database.prepare('SELECT ready FROM native_photo_query_builds_v2').get()?.ready, 0);
	}));
}
void test('Lightscaper native restore refuses incomplete, duplicate and out-of-order delivery without durable ready rows', { timeout: 15_000 }, async context => fixture(context, async f => {
	const r = records(), first = await f.create(r.root); await first.stage.writePhoto(r.photos[0]); await assert.rejects(first.stage.finish());
	const second = await f.create(r.root); await second.stage.writePhoto(r.photos[0]); await assert.rejects(second.stage.writePhoto(r.photos[0])); await assert.rejects(second.stage.finish());
	const third = await f.create(r.root); await assert.rejects(third.stage.writeStack(r.stack)); await assert.rejects(third.stage.finish());
}));
void test('Lightscaper native restore actual query INSERT failure rolls back its source/summary and both rows', { timeout: 15_000 }, async context => fixture(context, async f => {
	const r = records(1), { stage, database } = await f.create(r.root);
	database.exec("CREATE TRIGGER reject_row2 BEFORE INSERT ON native_photo_query_rows_v2 BEGIN SELECT RAISE(ABORT,'real query failure'); END");
	await assert.rejects(stage.writePhoto(r.photos[0]), /real query failure/u);
	for (const table of ['native_photos', 'native_photo_query_rows_v1', 'native_photo_query_rows_v2']) assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
	await assert.rejects(stage.finish()); database.exec('DROP TRIGGER reject_row2');
}));
void test('Lightscaper native restore actual deferred foreign-key COMMIT refusal rolls back final readiness', { timeout: 15_000 }, async context => fixture(context, async f => {
	const r = records(1), { stage, database } = await f.create(r.root); await stage.writePhoto(r.photos[0]);
	database.exec('CREATE TABLE final_parent(id INTEGER PRIMARY KEY); CREATE TABLE final_child(id INTEGER REFERENCES final_parent(id) DEFERRABLE INITIALLY DEFERRED)');
	database.exec('CREATE TRIGGER reject_ready AFTER UPDATE OF ready ON native_photo_query_builds_v2 WHEN NEW.ready=1 BEGIN INSERT INTO final_child VALUES(1); END');
	await assert.rejects(stage.finish(), /FOREIGN KEY/u); assert.equal(database.prepare('SELECT ready FROM native_photo_query_builds_v2').get()?.ready, 0);
	assert.equal(database.prepare('SELECT COUNT(*) AS n FROM final_child').get()?.n, 0); database.exec('DROP TRIGGER reject_ready; DROP TABLE final_child; DROP TABLE final_parent');
}));
void test('Lightscaper native restore opaque cancellation after final COMMIT preserves the genuine catalog finish ACK', { timeout: 15_000 }, async context => fixture(context, async f => {
	const r = records(1), { stage } = await f.create(r.root); await stage.writePhoto(r.photos[0]);
	const native = DatabaseSync.prototype.exec, reason = Object.freeze(Object.defineProperty({}, 'then', { get() { throw new Error('Opaque reason was inspected.'); } })); let committed = false;
	DatabaseSync.prototype.exec = function (sql: string): void {
		Reflect.apply(native, this, [sql]);
		if (sql === 'COMMIT' && this.prepare('SELECT ready FROM native_photo_query_builds_v2').get()?.ready === 1) { committed = true; f.abort(reason); }
	};
	try { const ready = await stage.finish(); assert.equal(committed, true); assert.equal(ready.photoCount, 1); }
	finally { DatabaseSync.prototype.exec = native; await stage.close(); }
}));
void test('Lightscaper native restore opaque cancellation before finish keeps original reason and unready rows', { timeout: 15_000 }, async context => fixture(context, async f => {
	const r = records(1), { stage, database } = await f.create(r.root); await stage.writePhoto(r.photos[0]); const reason = Object.freeze({ refused: true }); f.abort(reason);
	await opaque(stage.finish(), reason); assert.equal(database.prepare('SELECT ready FROM native_photo_query_builds_v2').get()?.ready, 0);
}));
