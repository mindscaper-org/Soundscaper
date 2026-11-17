/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import type { MidiClipData } from '../src/common/editor/midi-model.ts';

test('seeking after a second sostenuto press does not recapture a key released under sustain', async () => {
	const data: MidiClipData = { version: 1, notes: [{ id: 'held', pitch: 69, channel: 0, velocity: 100, startFrame: 0, durationFrames: 1000 }],
		interchange: { tempos: [], signatures: [], events: [
			{ frame: 500, status: 0xb0, data: [64, 127] },
			{ frame: 600, status: 0xb0, data: [66, 127] },
			{ frame: 1200, status: 0xb0, data: [66, 0] },
			{ frame: 1400, status: 0xb0, data: [66, 127] },
			{ frame: 2000, status: 0xb0, data: [64, 0] },
		] } };
	for (const origin of [0, 1800]) {
		const renderer = await openMidiAudioRenderer(data, 'fluidsynth', 8000, origin);
		try {
			const channels = await renderer.render(origin, 10000 - origin);
			assert.ok(channels[0]!.subarray(0, 200).some(value => Math.abs(value) > 0.001), 'the note is audible before sustain release');
			assert.ok(channels.every(channel => channel.subarray(7000 - origin).every(value => Math.abs(value) < 0.00001)),
				`origin ${origin}: released keys must finish their release instead of sticking under the second pedal`);
		} finally { await renderer.close(); }
	}
});

test('Reset All Controllers clears an earlier sostenuto capture before a later pedal press', async () => {
	const data: MidiClipData = { version: 1, notes: [{ id: 'held', pitch: 69, channel: 0, velocity: 100, startFrame: 0, durationFrames: 1300 }],
		interchange: { tempos: [], signatures: [], events: [
			{ frame: 500, status: 0xb0, data: [64, 127] }, { frame: 600, status: 0xb0, data: [66, 127] },
			{ frame: 1200, status: 0xb0, data: [121, 0] }, { frame: 1250, status: 0xb0, data: [64, 127] },
			{ frame: 1400, status: 0xb0, data: [66, 127] }, { frame: 2000, status: 0xb0, data: [64, 0] },
		] } };
	for (const origin of [0, 1800]) {
		const renderer = await openMidiAudioRenderer(data, 'fluidsynth', 8000, origin);
		try {
			const channels = await renderer.render(origin, 10000 - origin);
			assert.ok(channels[0]!.subarray(0, 200).some(value => Math.abs(value) > .001));
			assert.ok(channels.every(channel => channel.subarray(7000 - origin).every(value => Math.abs(value) < .00001)),
				`origin ${origin}: reset controllers must clear the old sostenuto capture`);
		} finally { await renderer.close(); }
	}
});
