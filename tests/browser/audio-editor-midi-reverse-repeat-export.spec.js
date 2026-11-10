/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, clipField, closeClipProperties, commitInput,
	disableNativeSavePicker, downloadBytes, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';

test('a trimmed reversed MIDI loop exports 10000 repeats from the ordinary Length control', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const events = Array.from({ length: 5000 }, (_, index) => ({ frame: index * 64, status: 176, data: [7, index === 4999 ? 80 : index % 128] }));
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [],
		tracks: [{ name: 'Recorded fader and note', durationFrames: 324_000, notes: [{ id: 'n', startFrame: 320_000,
			durationFrames: 4000, pitch: 60, velocity: 90, channel: 0 }], events }] });
	await importFiles(editor, [{ name: 'recorded-fader.mid', mimeType: 'audio/midi', buffer: Buffer.from(bytes) }]);
	const clip = clipByName(editor, 'Recorded fader and note');
	const properties = await openClipProperties(page, editor, clip);
	await commitInput(clipField(properties, 'sourceStartFrame'), '40');
	await expect(clipField(properties, 'durationFrame')).toHaveValue('0.5');
	await properties.getByRole('switch', { name: 'Reverse', exact: true }).click();
	await closeClipProperties(properties);
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const repeated = await openClipProperties(page, editor, clip);
	await commitInput(clipField(repeated, 'durationFrame'), '5000');
	await expect(clipField(repeated, 'durationFrame')).toHaveValue('5000');
	await closeClipProperties(repeated);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading;
	const output = await downloadBytes(download);
	await download.delete();
	expect(output.byteLength).toBe(130_080);
	expect(createHash('sha256').update(output).digest('hex')).toBe('7dbcafbcd9583684be02fd6941db2e27c9d3d3cabd8fd3d250d0ec74168f82cb');
});
