/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('streamed macro normalization belongs to optional execution instead of either product startup', () => {
	for (const path of ['src/common/editor/audacity-effects/streamed-normalization.ts',
		'src/common/editor/controller/effects/internal/macro/streamed-macro-normalization.ts']) {
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-execution', path);
	}
});
