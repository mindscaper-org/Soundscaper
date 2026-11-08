/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';

for (const donorNotes of [false, true]) test(`a foreign channel controller reaches its owner with note-bearing donor=${donorNotes}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const note = { id: 'n', pitch: 69, channel: 1, velocity: 100, startFrame: 0, durationFrames: 48_000 };
	const buffer = Buffer.from(writeMidiFile({ sampleRate: 48_000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [
		{ name: 'Donor', notes: donorNotes ? [{ ...note, id: 'a', channel: 0, pitch: 57 }] : [],
			events: [{ frame: 0, status: 177, data: [7, 0] }], durationFrames: 48_000 },
		{ name: 'Peer', notes: [note], durationFrames: 48_000 },
	] }));
	await importFiles(editor, [{ name: 'Separate channel controls.mid', mimeType: 'audio/midi', buffer }]);
	await editor.getByRole('group', { name: 'Peer track controls', exact: true })
		.getByRole('button', { name: 'Solo', exact: true }).click();
	const pcm = await exportSamples(page, editor);
	const peak = pcm.slice(12_000, 36_000).reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
	expect(peak).toBeLessThan(0.0001);
});
