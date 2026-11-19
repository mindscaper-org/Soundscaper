/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import type { MidiClipData } from '../src/common/editor/midi-model.ts';

test('seeking beyond a same-key retrigger release cannot resurrect the overlapping voice', async () => {
	const data: MidiClipData = { version: 1, notes: [
		{ id: 'first', channel: 0, pitch: 67, velocity: 100, startFrame: 0, durationFrames: 20000 },
		{ id: 'second', channel: 0, pitch: 67, velocity: 100, startFrame: 10000, durationFrames: 470000 },
	], interchange: { tempos: [], signatures: [], events: [{ frame: 0, status: 0xc0, data: [40] }] } };
	for (const origin of [0, 65536]) {
		const renderer = await openMidiAudioRenderer(data, 'fluidsynth', 48000, origin);
		try {
			const pcm = (await renderer.render(origin, 73728 - origin))[0]!;
			assert.ok(pcm.subarray(65536 - origin).every(sample => Math.abs(sample) < .000001),
				`origin ${String(origin)}: released repeated keys must remain silent`);
		} finally { await renderer.close(); }
	}
});
