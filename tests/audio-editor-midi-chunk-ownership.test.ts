/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('the opt-in piano roll and its design-system components initialize in one lazy owner', () => {
	for (const path of [
		'src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx',
		'src/common/editor/ui/workspace/PianoRollWorkspacePanel.css',
		'src/common/editor/ui/workspace/midi-panel-projection.ts',
		'vendor/audacity-design-system/components/src/PianoRoll/NoteGrid.tsx',
		'vendor/audacity-design-system/components/src/PianoRoll/PianoKeyboard.tsx',
		'vendor/audacity-design-system/components/src/NoteRect/NoteRect.tsx',
	]) assert.equal(chunkGroupForModulePath(path), 'editor-midi-piano-roll', path);
});
