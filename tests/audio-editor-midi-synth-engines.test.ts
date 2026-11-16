/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import { normalizeMidiTrackData } from '../src/common/editor/midi-model.ts';

for (const instrument of ['libadlmidi', 'fluidsynth'] as const) {
	test(`${instrument} renders real stereo PCM with sample-offset MIDI controls and survives state normalization`, async () => {
		assert.equal(normalizeMidiTrackData({ version: 1, instrument }).instrument, instrument);
		const data = { version: 1 as const, notes: [{ id: 'a', pitch: 69, velocity: 100, channel: 0, startFrame: 1000, durationFrames: 4000 }],
			interchange: { events: [{ frame: 7000, status: 0xb0, data: [120, 0] }], tempos: [], signatures: [] } };
		const renderer = await openMidiAudioRenderer(data, instrument, 48000);
		try {
			assert.equal(renderer.channelCount, 2);
			const output = await renderer.render(0, 12000);
			assert.equal(output.length, 2);
			assert.ok(output.every(channel => channel.every(Number.isFinite)));
			assert.ok(output[0]!.subarray(0, 900).every(value => value === 0), 'no note before its scheduled sample');
			assert.ok(output[0]!.subarray(1200, 4000).some(value => Math.abs(value) > 0.005), 'actual engine audio');
			assert.ok(output[0]!.subarray(9000).every(value => Math.abs(value) < 0.002), 'all sound off retires voices including the emulated chip release');
		} finally { await renderer.close(); }
	});
}
