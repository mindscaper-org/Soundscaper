/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('JUCE menu metadata shares the existing effect-contract chunk without a startup request', () => {
	for (const path of ['catalog.ts', 'catalog.json']) {
		assert.equal(chunkGroupForModulePath(`/repo/src/common/editor/juce-effects/${path}`), 'editor-effect-contracts');
	}
});
