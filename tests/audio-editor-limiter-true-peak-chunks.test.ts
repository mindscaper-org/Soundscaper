/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('limiter geometry shares effect contracts and oversampling stays with optional DSP', () => {
	for (const name of ['dynamics-definitions', 'true-peak-limiter-parameters']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/audacity-effects/${name}.ts`), 'editor-effect-contracts');
	}
	for (const name of ['limiter-live-processor', 'true-peak-oversampler']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/audacity-effects/${name}.ts`), 'editor-optional-execution');
	}
});
