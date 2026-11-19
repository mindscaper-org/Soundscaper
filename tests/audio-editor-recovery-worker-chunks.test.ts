/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { workerChunkGroups } from '../scripts/lib/build-worker-chunk-groups.mjs';

test('Audacity recovery checksum code shares the worker database owner instead of its dispatcher entry', () => {
	const owner = workerChunkGroups.find(group => group.name === 'editor-audacity-project-core-worker');
	assert.ok(owner?.test instanceof RegExp);
	const path = 'src/common/editor/wavpack/pcm.js';
	for (const candidate of [path, path.replaceAll('/', '\\')]) assert.equal(owner.test.test(candidate), true, candidate);
	assert.equal(owner.test.test('src/common/editor/aup4-worker.js'), false);
	assert.equal(owner.test.test('src/common/editor/audacity-project-page-recovery.ts'), false);
});
