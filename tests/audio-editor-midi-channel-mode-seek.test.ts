/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import type { MidiClipData } from '../src/common/editor/midi-model.ts';

for (const mode of [124, 125, 126, 127]) test(`seeking past MIDI channel mode CC${mode} does not resurrect released keys`, async () => {
	const data: MidiClipData = { version: 1, notes: [{ id: 'key', pitch: 69, channel: 0, velocity: 100, startFrame: 0, durationFrames: 12000 }],
		interchange: { tempos: [], signatures: [], events: [{ frame: 1000, status: 0xb0, data: [mode, mode === 126 ? 1 : 0] }] } };
	for (const origin of [0, 7000]) {
		const renderer = await openMidiAudioRenderer(data, 'fluidsynth', 8000, origin);
		try {
			const channels = await renderer.render(origin, 11000 - origin);
			if (!origin) assert.ok(channels[0]!.subarray(0, 500).some(value => Math.abs(value) > .001));
			assert.ok(channels.every(channel => channel.subarray(8000 - origin).every(value => Math.abs(value) < .00001)),
				`origin ${origin}: a mode change releases keys before the seek boundary`);
		} finally { await renderer.close(); }
	}
});
