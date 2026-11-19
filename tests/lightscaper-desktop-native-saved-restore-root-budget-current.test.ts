/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { createLightscaperNativeSmartCollectionRestoreCandidateCurrentV1 as fresh } from '../desktop/lightscaper-native-smart-collection-restore-candidate-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { seedNativeSmartCollectionFixtureCurrentV1 as seed } from './helpers/lightscaper-native-smart-collection-fixture-current.ts';
import { nativeStackQueryFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

test('Lightscaper native private saved restore applies owning2MiB root admission before any filesystem lookup', async () => {
	await fixture(async (db, path) => {
		const source = seed(db), rich = normalizePhotoCatalogRootV1({ ...source.root, folders: Array.from({ length: 10_000 }, (_, i) => ({ id: `folder-${i}`, name: 'X'.repeat(256), parentId: null })) });
		assert.ok(Buffer.byteLength(JSON.stringify(rich)) > 2 * 1024 * 1024);
		// The parent cannot exist: ENOENT would prove filesystem lookup ran before
		// the required document-budget refusal. No fs mocks or port callbacks.
		await assert.rejects(fresh(join(path, 'missing-parent'), rich, 11), /byte|budget/iu);
	});
});
