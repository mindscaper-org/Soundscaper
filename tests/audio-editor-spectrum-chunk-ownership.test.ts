/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('per-track spectrum rendering shares the deferred analyzer chunk', () => {
	for (const separator of ['/', '\\']) {
		const path = 'src/common/editor/controller/analysis/internal/specialized-analysis-report.ts'.replaceAll('/', separator);
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-execution');
	}
});
