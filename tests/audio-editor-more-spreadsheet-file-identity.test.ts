/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { planClipSpreadsheetEdits } from '../src/common/editor/clip-spreadsheet.ts';
import { planClipSpreadsheetInsert } from '../src/common/editor/clip-spreadsheet-insert.ts';
import { matchClipSpreadsheetSourceFiles } from '../src/common/editor/ui/clip-spreadsheet/paste.ts';

function project() {
	return createCurrentAudioEditorProject({ id: 'file-spelling', sampleRate: 48_000,
		sources: ['take.wav', ' take.wav '].map((name, index) => ({ id: `source-${index}`, storageKey: `source-${index}`,
			name, sampleRate: 48_000, frameCount: 48_000, channelCount: 1 })),
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'source-0', timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: 48_000, durationFrames: 48_000 }],
	});
}

test('typing a source filename in the spreadsheet selects its exact whitespace spelling', () => {
	const initial = project();
	const command = planClipSpreadsheetEdits(initial, [{ clipId: 'clip', column: 'source', value: ' take.wav ' }]);
	assert.ok(command);
	assert.equal(applyEditorCommand(initial, command).clips[0]?.sourceId, 'source-1');
});

test('pasting a new spreadsheet row resolves the exact filename before an unpadded namesake', () => {
	const initial = project();
	let id = 0;
	const command = planClipSpreadsheetInsert(initial, [{ source: ' take.wav ', track: 'voice' }],
		{ createId: prefix => `${prefix}-${++id}` });
	assert.ok(command);
	assert.equal(applyEditorCommand(initial, command).clips[1]?.sourceId, 'source-1');
});

test('spreadsheet source file choices keep edge spaces distinct and decode encoded file URLs', () => {
	const plain = { name: 'take.wav' };
	const padded = { name: ' take.wav ' };
	const references = ['take.wav', ' take.wav '];
	const files = matchClipSpreadsheetSourceFiles(references, [plain, padded]);
	assert.equal(files.get(references[0]!), plain);
	assert.equal(files.get(references[1]!), padded);
	assert.equal(matchClipSpreadsheetSourceFiles(['file:///audio/%20take.wav%20'], [padded]).values().next().value, padded);
});

test('a granted literal filename is not reinterpreted as a URL scheme', () => {
	const file = { name: 'mic:take.wav' };
	assert.equal(matchClipSpreadsheetSourceFiles([file.name], [file]).get(file.name), file);
	assert.throws(() => matchClipSpreadsheetSourceFiles(['https://ungranted.example/take.wav'], [file]), /local files/u);
});
