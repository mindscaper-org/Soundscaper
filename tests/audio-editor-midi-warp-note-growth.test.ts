/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { evaluateAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';

test('lengthening a note beyond a warped MIDI clip retains a valid playable map', async () => {
	const f = midiServiceFixture({
		sources: [createAudioSource({ id: 'original', sampleRate: 8_000, frameCount: 16_000, channelCount: 1 })],
		tracks: [{ ...createMidiTrack({ id: 'track', clipIds: ['clip'] }, 8_000) }],
		clips: [{ ...createMidiClip({ id: 'clip', sourceId: 'original', durationFrames: 16_000, sourceDurationFrames: 16_000,
			notes: [{ id: 'tone', pitch: 60, startFrame: 0, durationFrames: 8_000, velocity: 100, channel: 0 }],
			warpMap: { feature: 'audio-warp', points: [
				{ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' },
				{ outer: { num: 8_000, den: 1 }, source: { num: 12_000, den: 1 }, mode: 'forward' },
				{ outer: { num: 16_000, den: 1 }, source: { num: 16_000, den: 1 }, mode: 'forward' },
			] } }) }],
	});
	await f.service.updateNote('clip', 'tone', { durationFrames: 24_000 });
	assert.equal(readMidiClip(f.project().clips[0])?.notes[0]?.durationFrames, 24_000);
	assert.equal(f.project().clips[0]?.sourceDurationFrames, 24_000);
	assert.equal(f.project().clips[0]?.durationFrames, 32_000);
	assert.deepEqual(evaluateAudioWarpMap(f.project().clips[0]?.warpMap, 8_000), { num: 12_000, den: 1 });
	assert.deepEqual(evaluateAudioWarpMap(f.project().clips[0]?.warpMap, 16_000), { num: 16_000, den: 1 });
	assert.deepEqual(evaluateAudioWarpMap(f.project().clips[0]?.warpMap, 32_000), { num: 24_000, den: 1 });
});

test('warped beat-anchored MIDI note growth preserves earlier beat anchors and exposes the new tail', async () => {
	const f = midiServiceFixture({
		sources: [createAudioSource({ id: 'original', sampleRate: 8_000, frameCount: 16_000, channelCount: 1 })],
		tracks: [{ ...createMidiTrack({ id: 'track', clipIds: ['clip'] }, 8_000) }],
		clips: [{ ...createMidiClip({ id: 'clip', sourceId: 'original', durationFrames: 16_000, sourceDurationFrames: 16_000,
			anchor: 'musical', musicalStartBeat: { num: 4, den: 1 }, musicalExtent: 'beat', musicalDurationBeats: { num: 4, den: 1 },
			notes: [{ id: 'tone', pitch: 60, startFrame: 0, durationFrames: 8_000, velocity: 100, channel: 0 }],
			warpMap: { feature: 'audio-warp', points: [
				{ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' },
				{ outer: { num: 2, den: 1 }, source: { num: 12_000, den: 1 }, mode: 'forward' },
				{ outer: { num: 4, den: 1 }, source: { num: 16_000, den: 1 }, mode: 'forward' },
			] } }) }],
	});
	const original = f.project();
	await assert.rejects(f.service.updateNote('clip', 'tone', { durationFrames: 8_000 * 86_400 + 1 }), /24 hours/u);
	assert.equal(f.project(), original);
	assert.equal(f.pcm.size, 0, 'refused source growth publishes no source bytes');
	await f.service.updateNote('clip', 'tone', { durationFrames: 24_000 });
	const clip = f.project().clips[0]!;
	assert.deepEqual(clip.musicalDurationBeats, { num: 8, den: 1 });
	assert.equal(resolveRuntimeClipProjection(f.project(), { ...clip }).durationFrames, 32_000);
	assert.deepEqual(evaluateAudioWarpMap(clip.warpMap, 2), { num: 12_000, den: 1 });
	assert.deepEqual(evaluateAudioWarpMap(clip.warpMap, 8), { num: 24_000, den: 1 });
});
