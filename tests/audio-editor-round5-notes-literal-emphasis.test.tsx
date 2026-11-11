/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRecordingNotes, parseRecordingNotesMarkdown } from '../src/common/editor/recording-notes-markdown.ts';
import { assertNotesControllerCustody } from './helpers/notes-controller-custody.tsx';

for (const [format, kind, literal] of [
	['bold', 'strong', 'Use *.wav files'],
	['bold', 'strong', 'Record the _pickup'],
	['italic', 'emphasis', 'Use **.wav files'],
] as const) {
	test(`${format} previews a complete outer span with an unmatched literal delimiter: ${literal}`, () => {
		const formatted = formatRecordingNotes(literal, 0, literal.length, format, 'Placeholder');
		assert.deepEqual(parseRecordingNotesMarkdown(formatted.value), [{ kind: 'paragraph',
			content: [{ kind, content: [{ kind: 'text', text: literal }] }] }]);
		assert.equal(formatted.value.slice(formatted.selectionStart, formatted.selectionEnd), literal);
		assert.equal(formatRecordingNotes(formatted.value, formatted.selectionStart,
			formatted.selectionEnd, format, 'Placeholder').value, literal);
	});
}

test('the mounted Bold action renders an ordinary wildcard reminder without exposing its outer markers', async context => {
	await assertNotesControllerCustody(context, 'Use *.wav files', [{ action: 'bold', formatted: '**Use *.wav files**', element: 'strong', children: ['Use *.wav files'] }]);
});
