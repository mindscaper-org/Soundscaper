/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { projectUnwarpedClipSourceRange } from '../src/common/editor/audio-clip-source-projection.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';

for (const stretch of [1, 2]) test(`adding a later MIDI note preserves the sounding source phase of a split loop at${stretch}x duration`, async () => {
	const fixture = midiServiceFixture();
	const { clipId } = await fixture.service.addTrack();
	await fixture.service.addNote(clipId, { id: 'existing', pitch: 69, startFrame: 16000, durationFrames: 4000, velocity: 100, channel: 0 });
	fixture.apply({ type: 'clip/update', clipId, changes: { loop: { periodFrames: 64000 * stretch, durationFrames: 192000 * stretch } } });
	fixture.apply({ type: 'clip/split', clipId, atFrame: 16000 * stretch, rightClipId: 'right' });
	assert.deepEqual(readClipLoop(fixture.project().clips.find(clip => clip.id === 'right')!), { periodFrames: 64000 * stretch, offsetFrames: 16000 * stretch });
	const before = audibleHead();
	assert.ok(before.some(sample => Math.abs(sample) > 0.01), 'the child begins with its previously authored note');
	await fixture.service.addNote('right', { id: 'later', pitch: 72, startFrame: 80000, durationFrames: 4000, velocity: 100, channel: 0 });
	const clip = fixture.project().clips.find(candidate => candidate.id === 'right')!;
	const loop = readClipLoop(clip)!;
	assert.equal(readMidiClip(clip)?.notes.find(note => note.id === 'existing')?.startFrame, 16000);
	assert.ok(audibleHead().every((sample, index) => Object.is(sample, before[index])),
		'the same existing PCM must still sound at the right child start');
	assert.equal(loop.periodFrames, 84000 * stretch);
	assert.equal(loop.offsetFrames * Number(clip.sourceDurationFrames) / loop.periodFrames, 16000,
		'adding source notes must leave the already-audible note at the same loop phase');

	function audibleHead(): Float32Array {
		const current = fixture.project().clips.find(candidate => candidate.id === 'right')!;
		assert.equal(current.kind, 'audio');
		const range = projectUnwarpedClipSourceRange({ durationFrames: Number(current.durationFrames),
			sourceStartFrame: Number(current.sourceStartFrame), sourceDurationFrames: Number(current.sourceDurationFrames),
			reversed: Boolean(current.reversed), opaqueExtensions: current.opaqueExtensions }, 0, 512);
		const chunks = fixture.pcm.get(current.sourceId)!;
		const samples = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
		let offset = 0;
		for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
		return samples.slice(range.startFrame, range.endFrame);
	}
});
