/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';

test('piano-roll clip trimming preserves an existing half-speed stretch ratio', async () => {
	const f = midiServiceFixture();
	const { clipId } = await f.service.addTrack();
	f.apply({ type: 'clip/transform-many', transforms: [{ clipId, changes: { durationFrames: 128000, speedRatio: 0.5 } }], overwrite: false });
	await f.service.resizeClip(clipId, { timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 96000 });
	assert.equal(f.project().clips[0]?.durationFrames, 96000);
	assert.equal(f.project().clips[0]?.sourceDurationFrames, 48000);
});

test('piano-roll trimming a repeated MIDI clip preserves one repeat source window', async () => {
	const f = midiServiceFixture();
	const { clipId } = await f.service.addTrack();
	f.apply({ type: 'clip/update', clipId, changes: { loop: { periodFrames: 64000, durationFrames: 192000 } } });
	await f.service.resizeClip(clipId, { timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 128000 });
	assert.equal(f.project().clips[0]?.sourceDurationFrames, 64000);
	assert.deepEqual(readClipLoop(f.project().clips[0]!), { periodFrames: 64000, offsetFrames: 0 });
});

test('extending a repeated MIDI source with a new note preserves its repeat clock', async () => {
	const f = midiServiceFixture();
	const { clipId } = await f.service.addTrack();
	f.apply({ type: 'clip/update', clipId, changes: { loop: { periodFrames: 64000, durationFrames: 192000 } } });
	await f.service.addNote(clipId, { id: 'later', pitch: 60, startFrame: 80000, durationFrames: 4000, velocity: 100, channel: 0 });
	assert.equal(f.project().clips[0]?.sourceDurationFrames, 84000);
	assert.equal(f.project().clips[0]?.durationFrames, 252000);
	assert.deepEqual(readClipLoop(f.project().clips[0]!), { periodFrames: 84000, offsetFrames: 0 });
});

test('piano-roll trimming a warped MIDI clip follows its authored source boundary', async () => {
	const source = createAudioSource({ id: 'source', sampleRate: 8000, frameCount: 16000, channelCount: 1 });
	const f = midiServiceFixture({ sources: [source],
		clips: [{ ...createMidiClip({ id: 'clip', sourceId: source.id, durationFrames: 16000, sourceDurationFrames: 16000,
			warpMap: { feature: 'audio-warp', points: [
				{ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' },
				{ outer: { num: 8000, den: 1 }, source: { num: 12000, den: 1 }, mode: 'forward' },
				{ outer: { num: 16000, den: 1 }, source: { num: 16000, den: 1 }, mode: 'forward' },
			] } }) }], tracks: [{ ...createMidiTrack({ id: 'track', clipIds: ['clip'] }, 8000) }] });
	await f.service.resizeClip('clip', { timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 8000 });
	assert.equal(f.project().clips[0]?.durationFrames, 8000);
	assert.equal(f.project().clips[0]?.sourceDurationFrames, 12000);
});
