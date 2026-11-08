/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

test('editing a note on a beat-anchored MIDI clip resolves its musical extent', async () => {
	const f = midiServiceFixture({
		sources: [createAudioSource({ id: 'source', sampleRate: 8000, frameCount: 16000, channelCount: 1 })],
		clips: [{ ...createMidiClip({ id: 'clip', sourceId: 'source', durationFrames: 16000, sourceDurationFrames: 16000,
			anchor: 'musical', musicalStartBeat: { num: 4, den: 1 }, musicalExtent: 'beat', musicalDurationBeats: { num: 4, den: 1 },
			notes: [{ id: 'note', pitch: 60, startFrame: 0, durationFrames: 4000, velocity: 100, channel: 0 }] }) }],
		tracks: [{ ...createMidiTrack({ id: 'track', clipIds: ['clip'] }, 8000) }],
	});
	await f.service.updateNote('clip', 'note', { pitch: 67 });
	assert.equal(readMidiClip(f.project().clips[0])?.notes[0]?.pitch, 67);
	assert.deepEqual(f.project().clips[0]?.musicalDurationBeats, { num: 4, den: 1 });
});
