/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('transcript editing and generation stay behind the menu-opened panel boundary', () => {
	for (const path of [
		'transcript-editing.ts', 'controller/composition/internal/transcript-editing-actions.ts',
		'controller/assistance/transcript-generation-session.ts', 'ui/workspace/TranscriptEditingPanel.tsx',
		'ui/workspace/TranscriptGeneration.tsx', 'ui/workspace/transcript-dom-selection.ts',
	]) assert.equal(chunkGroupForModulePath(`/repo/src/common/editor/${path}`), 'editor-transcript-editing', path);
	assert.notEqual(chunkGroupForModulePath('/repo/src/common/editor/controller/composition/transcript-editing-actions.ts'), 'editor-transcript-editing');
});
