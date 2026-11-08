/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { constants } from 'node:sqlite';
import test from 'node:test';
import { createLightscaperNativeSmartCollectionRestoreStageCurrentV1 as create } from '../desktop/lightscaper-native-smart-collection-restore-stage-current-v1.ts';
import { createLightscaperNativeSmartCollectionRestoreCandidateCurrentV1 as fresh } from '../desktop/lightscaper-native-smart-collection-restore-candidate-current-v1.ts';
import { isLightscaperNativeSmartCollectionCleanupFailureCurrentV1 as cleanupFailure } from '../desktop/lightscaper-native-smart-collection-transaction-current-v1.ts';
import { seedNativeSmartCollectionFixtureCurrentV1 as seed } from './helpers/lightscaper-native-smart-collection-fixture-current.ts';
import { nativeStackQueryFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

test('Lightscaper native private saved restore preserves constructor rollback cleanup failure through candidate retirement', async () => {
	await fixture(async (active, path) => {
		const source = seed(active), candidate = await fresh(dirname(path), source.root, 11), db = candidate.database;
		db.setAuthorizer((action, first) => {
			if (action === constants.SQLITE_INSERT && first === 'native_photo_smart_collection_states') return constants.SQLITE_DENY;
			if (action === constants.SQLITE_TRANSACTION && first === 'ROLLBACK') return constants.SQLITE_DENY;
			return constants.SQLITE_OK;
		});
		let failure: unknown;
		try {
			create(candidate.permit, { schemaVersion: 1, kind: 'photo-smart-collection-archive-context', catalogId: 'catalog', catalogRevision: 3, indexRevision: 11,
				state: { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 9, collectionCount: 0 } });
			assert.fail('Native INSERT and ROLLBACK must fail.');
		} catch (error) { failure = error; } finally { db.setAuthorizer(null); }
		assert.equal(cleanupFailure(failure), true);
		await assert.rejects(candidate.close(), (error: unknown) => error instanceof AggregateError && error.errors.includes(failure));
		assert.equal(db.isOpen, false); await access(candidate.directory);
		// The failed candidate stays as evidence until native SQLite closure is
		// actually witnessed above. Only then does this fixture reclaim its dir.
		await rm(candidate.directory, { recursive: true, force: false });
	});
});
