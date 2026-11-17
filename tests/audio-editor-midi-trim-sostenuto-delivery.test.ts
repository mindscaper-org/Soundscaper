/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('MIDI delivery refuses to silently lose a trimmed sostenuto-held voice', async () => {
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Sostenuto', durationFrames: 16000,
		notes: [{ id: 'held', pitch: 67, channel: 0, velocity: 100, startFrame: 0, durationFrames: 2000 }],
		events: [{ frame: 0, status: 0xc0, data: [40] }, { frame: 1000, status: 0xb0, data: [66, 127] }, { frame: 12000, status: 0xb0, data: [66, 0] }],
	}] });
	const f = midiServiceFixture(); await f.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	await f.service.setInstrument(f.project().tracks[0]!.id, 'fluidsynth');
	const clip = f.project().clips[0]!;
	assert.ok(f.pcm.get(clip.sourceId)?.[0]?.subarray(4000, 8000).some(sample => Math.abs(sample) > .001), 'the library instrument still sounds after key release');
	f.apply({ type: 'clip/trim', clipId: clip.id, sourceStartFrame: 4000, sourceDurationFrames: 12000, durationFrames: 12000 });
	await assert.rejects(f.service.exportFile('midi'), /sostenuto.*held/iu);
	assert.equal(f.saves.length, 0);
});

for (const trimmed of [false, true]) test(`ordinary sostenuto delivery remains available, trimmed after release=${String(trimmed)}`, async () => {
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Released pedal', durationFrames: 16000,
		notes: [{ id: 'held', pitch: 67, channel: 0, velocity: 100, startFrame: 0, durationFrames: 2000 }],
		events: [{ frame: 1000, status: 0xb0, data: [66, 127] }, { frame: 3000, status: 0xb0, data: [66, 0] }],
	}] });
	const f = midiServiceFixture(); await f.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	if (trimmed) f.apply({ type: 'clip/trim', clipId: f.project().clips[0]!.id, sourceStartFrame: 4000, sourceDurationFrames: 12000, durationFrames: 12000 });
	await f.service.exportFile('midi');
	assert.equal(f.saves.length, 1);
});

test('a cut sostenuto tail cannot spill through the gap to a later clip', async () => {
	const f = midiServiceFixture();
	const [created] = await f.service.importDocument({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Cut pedal', durationFrames: 16000,
		notes: [{ id: 'held', pitch: 67, channel: 0, velocity: 100, startFrame: 0, durationFrames: 2000 }],
		events: [{ frame: 1000, status: 0xb0, data: [66, 127] }, { frame: 12000, status: 0xb0, data: [66, 0] }],
	}] });
	assert.ok(created?.trackId);
	await f.service.resizeClip(created.clipId, { timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 4000 });
	f.apply({ type: 'clip/add', trackId: created.trackId, clip: { ...f.project().clips[0]!, id: 'later', timelineStartFrame: 16000 } });
	await assert.rejects(f.service.exportFile('midi'), /sostenuto.*held/iu);
	assert.equal(f.saves.length, 0);
});
