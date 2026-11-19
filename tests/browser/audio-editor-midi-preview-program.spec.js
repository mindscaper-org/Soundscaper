/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { openMidiAudioRenderer } from '../../src/common/editor/engine/midi-audio-renderer.ts';

test('selected-note audition retains the imported channel program', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const buffer = Buffer.from(writeMidiFile({ sampleRate: 48000, tempos: [], signatures: [], tracks: [{ name: 'Saved patch',
		notes: [{ id: 'key', pitch: 67, velocity: 100, channel: 3, startFrame: 0, durationFrames: 48000 }],
		events: [{ frame: 0, status: 0xc3, data: [40] }], durationFrames: 48000,
	}] }));
	await importFiles(editor, [{ name: 'Saved patch.mid', mimeType: 'audio/midi', buffer }]);
	await clipByName(editor, 'Saved patch').click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	await panel.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('fluidsynth');
	await panel.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	await page.evaluate(() => {
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer?.length === Math.round(this.context.sampleRate * .35)) {
				globalThis.__selectedNotePreview = { rate: this.buffer.sampleRate, pcm: Array.from(this.buffer.getChannelData(0)) };
			}
			return Reflect.apply(start, this, args);
		};
	});
	await panel.getByRole('button', { name: 'Preview selected note', exact: true }).click();
	await expect.poll(() => page.evaluate(() => Boolean(globalThis.__selectedNotePreview))).toBe(true);
	const voice = await page.evaluate(() => globalThis.__selectedNotePreview);
	const frames = Math.round(voice.rate * .35);
	const renderer = await openMidiAudioRenderer({ version: 1, notes: [{ id: 'preview', pitch: 67, channel: 3, velocity: 100,
		startFrame: 0, durationFrames: frames }], interchange: { tempos: [], signatures: [], events: [{ frame: 0, status: 0xc3, data: [40] }] } }, 'fluidsynth', voice.rate);
	try {
		const expected = (await renderer.render(0, frames))[0];
		const error = Math.sqrt(voice.pcm.reduce((sum, value, index) => sum + (value - expected[index]) ** 2, 0) / frames);
		expect(error).toBeLessThan(.00001);
	} finally { await renderer.close(); }
});
