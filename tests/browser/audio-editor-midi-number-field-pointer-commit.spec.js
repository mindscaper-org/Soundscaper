/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, clickClipInterior, clipByName,
	disableNativeSavePicker, downloadBytes, importFiles,
} from './audio-editor-test-helpers.js';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';

for (const destination of ['another field', 'another clip']) test(`a typed MIDI pitch commits before pointing to ${destination}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const bytes = writeMidiFile({ sampleRate: 48_000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [
		{ name: 'First', notes: [{ id: 'a', pitch: 60, channel: 0, velocity: 90, startFrame: 0, durationFrames: 12_000 }] },
		{ name: 'Second', notes: [{ id: 'b', pitch: 64, channel: 1, velocity: 90, startFrame: 0, durationFrames: 12_000 }] },
	] });
	await importFiles(editor, [{ name: 'Two tracks.mid', mimeType: 'audio/midi', buffer: Buffer.from(bytes) }]);
	await clickClipInterior(page, clipByName(editor, 'First'));
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const group = editor.getByRole('group', { name: 'Note editor', exact: true });
	await group.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const pitch = group.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true });
	await expect(pitch).toHaveValue('60');
	await pitch.fill('67');
	if (destination === 'another clip') {
		await clickClipInterior(page, clipByName(editor, 'Second'));
		await expect(pitch).toBeDisabled();
	} else await group.getByRole('spinbutton', { name: 'Velocity', exact: true }).click();
	const deliveredPitch = async () => {
		const downloading = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
		const download = await downloading;
		const document = parseMidiFile(await downloadBytes(download));
		await download.delete();
		return document.tracks.find(track => track.name === 'First')?.notes[0]?.pitch;
	};
	expect(await deliveredPitch()).toBe(67);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	expect(await deliveredPitch()).toBe(60);
});
