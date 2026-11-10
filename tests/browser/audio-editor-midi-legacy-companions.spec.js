/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { legacyAupFiles } from '../helpers/more200-legacy-aup-file.ts';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';

// Companion ordering variants retain real AU/WAV/MIDI/controller/store/Scape custody in audio-editor-midi-batch-import-archive-custody.test.ts.
for (const midiPosition of ['middle']) test(`legacy project and selected AU blocks stay together: MIDI ${midiPosition}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const legacy = { name: projectFile.name, mimeType: projectFile.type, buffer: Buffer.from(await projectFile.arrayBuffer()) };
	const block = { name: dataFile.name, mimeType: dataFile.type, buffer: Buffer.from(await dataFile.arrayBuffer()) };
	const independent = createWavFixture({ name: 'Independent.au', duration: .1, frequency: 330, channelCount: 1 });
	const midi = { name: 'Extra MIDI.mid', mimeType: 'audio/midi', buffer: Buffer.from(writeMidiFile({ sampleRate: 48_000,
		tempos: [], signatures: [], tracks: [{ name: 'Extra MIDI', notes: [{ id: 'n', pitch: 60, channel: 0,
			velocity: 90, startFrame: 0, durationFrames: 4800 }] }] })) };
	const files = midiPosition === 'none' ? [legacy, block, independent]
		: midiPosition === 'first' ? [midi, legacy, block, independent] : [legacy, midi, block, independent];
	await importFiles(editor, files);
	if (midiPosition !== 'none') await expect(clipByName(editor, 'Extra MIDI')).toBeVisible();
	await expect(editor.locator('[data-track-row] .track-control-panel__track-name-text').filter({ hasText: /^Voix 日本語 🎙$/u })).toHaveCount(1);
	await expect(clipByName(editor, independent.name)).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', midiPosition === 'none' ? '2' : '3');
});
