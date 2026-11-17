/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY, IMPORTED, LOCATOR_REVISION, claim, messages, projectAt, rig, watchedFile, type Rig }
	from './helpers/framescaper-native-watch-import-rig.ts';

test('a project swapped out while the locator loads returns the abandoned claim to main', async () => {
	const scope: Rig = rig({
		load: async () => {
			scope.state.project = projectAt(7, [], []);
			return { blob: watchedFile(), locatorRevision: LOCATOR_REVISION };
		},
	});

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(messages(scope.rec), ['The active selected project changed during watch import.']);
	assert.equal(scope.rec.completions[0]?.success, false);
	assert.equal(scope.rec.completions[0]?.committedProjectRevision, 2);
});

test('changing tabs during import acknowledgement never flushes the replacement tab', async () => {
	const scope: Rig = rig({
		onImportFiles: state => { state.project = IMPORTED; },
		complete: () => { scope.state.project = { ...EMPTY, id: 'project-2' }; return false; },
	});
	assert.equal(await scope.watcher.pollNow(), false);
	assert.equal(scope.rec.flushes.length, 1);
	assert.equal(scope.rec.completions.length, 1);
});

test('a watch claim requiring a proxy never reports success after proxy generation falls short', async () => {
	const scope = rig({
		claim: claim({ generateProxies: true }),
		onImportFiles: state => { state.project = IMPORTED; },
		proxy: () => undefined,
	});
	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(scope.rec.completions.map(item => [item.success, item.committedProjectRevision]), [[false, 2]]);
	assert.equal(scope.rec.flushes.length, 1);
});
