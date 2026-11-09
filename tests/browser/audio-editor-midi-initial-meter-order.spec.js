/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { parseMidiFile } from '../../src/common/editor/midi-file.ts';
import { initialMeterMidi } from '../helpers/midi-initial-meter-fixture.ts';

test('MIDI picker and export retain the final initial meter and its later change', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Initial meters.mid', mimeType: 'audio/midi', buffer: Buffer.from(initialMeterMidi()) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading;
	const path = await download.path();
	expect(path).not.toBeNull();
	const document = parseMidiFile(await readFile(path));
	await download.delete();
	expect(document.signatures).toEqual([
		{ frame: 0, numerator: 4, denominator: 4, clocksPerMetronomeClick: 36, notated32ndNotesPerQuarter: 12 },
		{ frame: 24000, numerator: 6, denominator: 8, clocksPerMetronomeClick: 72 },
	]);
	expect(document.tracks.find(track => track.notes.length)?.notes[0]?.durationFrames).toBe(48000);
});
