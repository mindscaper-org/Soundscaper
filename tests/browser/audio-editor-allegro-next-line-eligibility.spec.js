/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { parseMidiFile } from '../../src/common/editor/midi-file.ts';

for (const event of [true, false]) test(`Allegro next interval applies only to an event line: event=${event}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const source = event ? '#track 0\nT0 N0.5 V0 -control7r:1.0\nP60 U0.25\n' : '#track 0\nN0.5\nV0 P60 U0.25\n';
	await importFiles(editor, [{ name: 'Next interval.gro', mimeType: 'text/plain', buffer: Buffer.from(source) }]);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading;
	const document = parseMidiFile(await downloadBytes(download));
	await download.delete();
	const notes = document.tracks.flatMap(track => track.notes);
	expect(notes).toHaveLength(1);
	expect(notes[0].durationFrames).toBe(12000);
	expect(notes[0].startFrame).toBe(event ? 24000 : 0);
});
