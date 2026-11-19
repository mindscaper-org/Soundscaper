/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeImportPresetFacetFixtureCurrentV1 as fixture, exactNativeImportPresetFailureCurrentV1 as exactFailure } from './helpers/lightscaper-native-import-preset-facet-fixture-current.ts';
import { observeNativePhotoSettingsSqlCurrentV1 as observe } from './helpers/lightscaper-native-photo-settings-integration-fixture-current.ts';

void test('Lightscaper import-preset stop after actual SQLite BEGIN rolls back before CAS acknowledgment', { timeout: 15_000 }, async context => {
	const f = await fixture(context), reason = Symbol('selected epoch stopped after genuine BEGIN'); let began = 0, committed = 0, rolledBack = 0;
	await observe(f.databasePath, (_database, sql) => {
		if (sql === 'BEGIN IMMEDIATE') { began++; f.retire(reason); }
		if (sql === 'COMMIT') committed++;
		if (sql === 'ROLLBACK') rolledBack++;
	}, async () => { await exactFailure(f.values.putIfAbsent(f.key, { refused: true }), reason); });
	assert.equal(began, 1); assert.equal(committed, 0); assert.equal(rolledBack, 1);
	assert.deepEqual(await f.owner.settingsRepository.readEntry(f.key), { present: false });
	await f.facet.close();
});
