/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePreviewCacheFixtureCurrentV1 as fixture, nativePreviewProfileCurrentV1 as profile,
	nativePreviewDigestCurrentV1 as digest } from './helpers/lightscaper-native-photo-preview-cache-fixture-current.ts';

void test('Native cache stage COMMIT rollback leaves no payload and permits a genuine retry', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const core = f.owner.createBinaryDerivativeCache(profile()), identity = f.identity('stage-rollback', 5);
		f.db.exec(`CREATE TABLE stage_parent(id INTEGER PRIMARY KEY);
			CREATE TABLE stage_child(id INTEGER REFERENCES stage_parent(id) DEFERRABLE INITIALLY DEFERRED);
			CREATE TRIGGER refuse_stage_commit AFTER INSERT ON native_photo_preview_staging BEGIN INSERT INTO stage_child VALUES(9); END`);
		await assert.rejects(core.store(identity, new Blob(['bytes']), digest('bytes')));
		for (const table of ['native_photo_preview_staging', 'native_photo_preview_bodies', 'native_photo_preview_entries', 'stage_child']) {
			assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
		}
		f.db.exec('DROP TRIGGER refuse_stage_commit; DROP TABLE stage_child; DROP TABLE stage_parent');
		assert.equal((await core.store(identity, new Blob(['bytes']), digest('bytes'))).outcome, 'stored');
		assert.ok(await core.load(identity));
	});
});
