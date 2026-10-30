/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRecordingNotes } from '../src/common/editor/recording-notes-markdown.ts';

test('multiline Code indexes each selected line without rebuilding the whole notebook per line', () => {
	const value = Array.from({ length: 1000 }, (_, i) => `Session note ${i}: microphone placement and levels`).join('\n');
	const original = String.prototype.matchAll;
	let indexedCharacters = 0;
	String.prototype.matchAll = function (this: string, expression: RegExp) { if (expression.source === '`+') indexedCharacters += this.length; return Reflect.apply(original, this, [expression]) as RegExpStringIterator<RegExpExecArray>; };
	try {
		const formatted = formatRecordingNotes(value, 0, value.length, 'code', 'Note');
		assert.equal(formatted.value, value.split('\n').map(line => `\`${line}\``).join('\n'));
		assert.ok(indexedCharacters < value.length * 8, `${indexedCharacters} indexed characters for ${value.length} input characters`);
		const restored = formatRecordingNotes(formatted.value, formatted.selectionStart, formatted.selectionEnd, 'code', 'Note');
		assert.equal(restored.value, value);
	} finally { String.prototype.matchAll = original; }
});

test('multiline formatting retains partial selections, list prefixes and outer text', () => {
	const value = 'Outside\n- first note\n  second note  \nOutside';
	const from = value.indexOf('first'), to = value.indexOf('\nOutside', from);
	for (const format of ['bold', 'italic', 'code'] as const) {
		const formatted = formatRecordingNotes(value, from, to, format, 'Note');
		const restored = formatRecordingNotes(formatted.value, formatted.selectionStart, formatted.selectionEnd, format, 'Note');
		assert.equal(restored.value, value);
		assert.ok(formatted.value.startsWith('Outside\n- '));
		assert.ok(formatted.value.endsWith('\nOutside'));
	}
});
