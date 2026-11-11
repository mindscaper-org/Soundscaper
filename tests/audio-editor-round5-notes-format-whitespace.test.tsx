/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRecordingNotes, parseRecordingNotesMarkdown } from '../src/common/editor/recording-notes-markdown.ts';
import { assertNotesControllerCustody } from './helpers/notes-controller-custody.tsx';

for (const format of ['bold', 'italic'] as const) test(`notes ${format} formats the content inside a whitespace-bearing selection`, () => {
	const marker = format === 'bold' ? '**' : '*';
	const value = '\t First take \n';
	const result = formatRecordingNotes(value, 0, value.length, format, 'placeholder');
	assert.deepEqual(result, { value: `\t ${marker}First take${marker} \n`,
		selectionStart: 2 + marker.length, selectionEnd: 12 + marker.length });
	assert.deepEqual(parseRecordingNotesMarkdown(result.value), [{ kind: 'paragraph', content: [
		{ kind: 'text', text: '\t ' },
		{ kind: format === 'bold' ? 'strong' : 'emphasis', content: [{ kind: 'text', text: 'First take' }] },
		{ kind: 'text', text: ' ' },
	] }]);
	assert.equal(formatRecordingNotes(result.value, 0, result.value.length, format, '').value, value);
	assert.deepEqual(formatRecordingNotes(' \t\n', 0, 3, format, 'placeholder'), {
		value: ' \t\n', selectionStart: 0, selectionEnd: 3,
	});
});

test('notes inline code preserves selected whitespace inside code delimiters', () => {
	assert.deepEqual(formatRecordingNotes(' take ', 0, 6, 'code', 'Code'), {
		value: '` take `', selectionStart: 1, selectionEnd: 7,
	});
});

test('the mounted notes panel restores the trimmed content selection and renders the authored emphasis', async context => {
	await assertNotesControllerCustody(context, ' First take ', [{ action: 'bold', formatted: ' **First take** ', element: 'strong', children: ['First take'], selection: [3, 13] }]);
});
