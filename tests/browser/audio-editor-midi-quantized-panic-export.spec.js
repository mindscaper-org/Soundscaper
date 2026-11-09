/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles,
} from './audio-editor-test-helpers.js';
import { parseMidiFile } from '../../src/common/editor/midi-file.ts';
import { renderMidiFrames } from '../../src/common/editor/engine/midi-synthesis.ts';

function midi(delta) {
	const variable = value => {
		const bytes = [value & 127];
		for (value >>= 7; value; value >>= 7) bytes.unshift((value & 127) | 128);
		return bytes;
	};
	const body = [0, 0xb0, 64, 127, 0, 0x90, 69, 100, ...variable(delta), 0xb0, 120, 0,
		...variable(16_384 - delta), 0xb0, 64, 0, 0, 255, 47, 0];
	return Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 127, 255,
		77, 84, 114, 107, 0, 0, 0, body.length, ...body]);
}

function lateEnergy(document) {
	return document.tracks.reduce((energy, track) => energy + renderMidiFrames(
		track.notes, 'triangle', 48_000, 512, 4096, track.events,
	).reduce((sum, value) => sum + value * value, 0), 0);
}

for (const delta of [0, 1, 3]) test(`MIDI delivery retains a killed voice across tick rounding (${delta} source ticks)`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const bytes = midi(delta);
	expect(lateEnergy(parseMidiFile(bytes))).toBe(0);
	await importFiles(editor, [{ name: 'Killed voice.mid', mimeType: 'audio/midi', buffer: bytes }]);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading;
	const document = parseMidiFile(await downloadBytes(download));
	await download.delete();
	expect(document.tracks.flatMap(track => track.notes)).toHaveLength(1);
	expect(lateEnergy(document)).toBe(0);
});
