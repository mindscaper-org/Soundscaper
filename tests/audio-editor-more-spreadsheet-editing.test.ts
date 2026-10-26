/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { getClipSpreadsheetRows, planClipSpreadsheetEdits } from '../src/common/editor/clip-spreadsheet.ts';

function fixture(gain: number) {
	return applyEditorCommand(createCurrentAudioEditorProject({ id: 'project', sampleRate: 48_000 }), {
		type: 'batch', commands: [
			{ type: 'source/add', source: { id: 'source', name: 'Voice.wav', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 } },
			{ type: 'track/add', track: { id: 'track', name: 'Voice' } },
			{ type: 'clip/add', trackId: 'track', clip: { id: 'clip', sourceId: 'source', durationFrames: 48_000, sourceDurationFrames: 48_000, gain } },
		],
	});
}

test('spreadsheet gain edits preserve quiet values and can mute an already quiet clip', () => {
	for (const [initial, entered, expected] of [[0, '-260', '-260'], [1e-13, '-Infinity', '-Infinity'], [1e-13, '-280', '-280']] as const) {
		const project = fixture(initial);
		const command = planClipSpreadsheetEdits(project, [{ clipId: 'clip', column: 'gain', value: entered }]);
		assert.ok(command, `${String(initial)} -> ${entered} must create an edit`);
		const changed = applyEditorCommand(project, command);
		assert.equal(getClipSpreadsheetRows(changed)[0]?.cells.gain, expected);
	}
});
