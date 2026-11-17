/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles, seekOnRuler } from './audio-editor-test-helpers.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { openMidiAudioRenderer } from '../../src/common/editor/engine/midi-audio-renderer.ts';

for (const retrigger of [false, true]) test(retrigger ? 'seeking beyond a repeated key release keeps it silent' : 'seeking a MIDI recording keeps the sounding note original patch', async ({ page }) => {
	await page.addInitScript(() => {
		const Original = globalThis.Worker;
		globalThis.Worker = class extends Original {
			constructor(url, options) {
				super(url, options); this.requests = new Map();
				if (options?.name === 'soundscaper-midi') this.addEventListener('message', ({ data }) => {
					if (this.origin > 0 && data.channels && !globalThis.__heldPatchPcm) globalThis.__heldPatchPcm = {
						origin: this.origin, start: this.requests.get(data.id)?.start, rate: this.rate, pcm: Array.from(data.channels[0]),
					};
				});
			}
			postMessage(data, ...args) {
				this.requests.set(data.id, data);
				if (data.data) { this.origin = data.initialFrame; this.rate = data.sampleRate; }
				return super.postMessage(data, ...args);
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const note = { id: 'held', pitch: 67, channel: 0, velocity: 100, startFrame: 0, durationFrames: 480000 };
	const events = [{ frame: 0, status: 0xc0, data: [40] }, ...retrigger ? [] : [{ frame: 12000, status: 0xc0, data: [80] }]];
	const notes = retrigger ? [{ ...note, durationFrames: 20000 }, { ...note, id: 'retrigger', startFrame: 10000, durationFrames: 470000 }] : [note];
	const buffer = Buffer.from(writeMidiFile({ sampleRate: 48000, tempos: [], signatures: [], tracks: [{ name: 'Held patch', notes, events, durationFrames: 480000 }] }));
	await importFiles(editor, [{ name: 'Held patch.mid', mimeType: 'audio/midi', buffer }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	await editor.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('fluidsynth');
	await seekOnRuler(page, editor, 400);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => Boolean(globalThis.__heldPatchPcm))).toBe(true);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	const actual = await page.evaluate(() => globalThis.__heldPatchPcm);
	expect(actual.origin).toBeGreaterThan(12000);
	if (retrigger) {
		expect(actual.pcm.every(sample => Math.abs(sample) < .000001)).toBe(true);
		return;
	}
	const renderer = await openMidiAudioRenderer({ version: 1, notes: [note], interchange: { tempos: [], signatures: [], events: [events[0]] } }, 'fluidsynth', actual.rate);
	try {
		const expected = (await renderer.render(actual.start - actual.origin, actual.pcm.length))[0];
		const error = actual.pcm.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - expected[frame])), 0);
		expect(error).toBeLessThan(.00001);
	} finally { await renderer.close(); }
});
