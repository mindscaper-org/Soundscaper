/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRecordingNotes, parseRecordingNotesMarkdown } from '../src/common/editor/recording-notes-markdown.ts';

for (const format of ['bold', 'italic'] as const) {
	for (const tail of ['\\', '\\\\', '\\\\\\']) test(`${format} retains a note's trailing ${tail.length} backslashes`, () => {
		const value = `C:\\Takes${tail}`;
		const original = parseRecordingNotesMarkdown(value);
		const formatted = formatRecordingNotes(value, 0, value.length, format, format);
		assert.deepEqual(parseRecordingNotesMarkdown(formatted.value), [{ kind: 'paragraph', content: [{
			kind: format === 'bold' ? 'strong' : 'emphasis', content: original[0]?.kind === 'paragraph' ? original[0].content : [],
		}] }]);
		const removed = formatRecordingNotes(formatted.value, formatted.selectionStart, formatted.selectionEnd, format, format);
		assert.deepEqual(parseRecordingNotesMarkdown(removed.value), original, 'toggling formatting preserves the rendered path');
	});
}

test('formatting a selected path leaves neighbouring notes and existing escapes intact', () => {
	const value = 'Folder: C:\\Takes\\ — keep \\*literal\\*';
	const start = 'Folder: '.length;
	const end = start + 'C:\\Takes\\'.length;
	const formatted = formatRecordingNotes(value, start, end, 'bold', 'Bold');
	assert.deepEqual(parseRecordingNotesMarkdown(formatted.value), [{ kind: 'paragraph', content: [
		{ kind: 'text', text: 'Folder: ' }, { kind: 'strong', content: [{ kind: 'text', text: 'C:\\Takes\\' }] },
		{ kind: 'text', text: ' — keep *literal*' },
	] }]);
});
