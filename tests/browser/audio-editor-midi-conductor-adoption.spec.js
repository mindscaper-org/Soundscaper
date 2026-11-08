/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, clipByName, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { readMidiClip } from '../../src/common/editor/midi-model.ts';

for (const existing of [false, true]) test(`File Import retains a fast MIDI source with existing audio=${existing}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	if (existing) await importFiles(editor, [createWavFixture({ name: 'Existing.wav', duration: .1, channelCount: 1, frequency: 330 })]);
	await expect(editor).toHaveAttribute('data-clip-count', existing ? '1' : '0');
	await importFiles(editor, [{ name: 'Fast.mid', mimeType: 'audio/midi', buffer: Buffer.from(fastMidi()) }]);
	await expect(clipByName(editor, 'Fast')).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', existing ? '2' : '1');
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const project = JSON.parse(strFromU8(unzipSync(await downloadBytes(download))['project.json']));
	await download.delete();
	const clip = project.clips.find(candidate => candidate.title === 'Fast');
	expect(clip).toBeTruthy();
	const data = readMidiClip(clip);
	expect(data.interchange.tempos[0].bpm).toBe(1200);
	expect(data.notes[0].durationFrames).toBe(24_000);
	expect(project.sources.find(source => source.id === clip.sourceId).frameCount).toBe(24_000);
	expect(project.tempo.bpm).toBe(120);
	expect(project.tempo.timeSignature).toEqual({ numerator: existing ? 4 : 3, denominator: 4 });
	const samples = await exportSamples(page, editor);
	let peak = 0;
	// The healthy WAV has ended by 0.1s; this window contains only the imported MIDI.
	for (let index = 9600; index < 19200; index++) peak = Math.max(peak, Math.abs(samples[index]));
	expect(peak).toBeGreaterThan(.05);
});

function fastMidi() {
	const name = [...new TextEncoder().encode('Fast')];
	const events = [0, 255, 81, 3, 0, 195, 80, 0, 255, 88, 4, 3, 2, 24, 8,
		0, 255, 3, name.length, ...name, 0, 144, 60, 100, 165, 64, 128, 60, 0, 0, 255, 47, 0];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
}
