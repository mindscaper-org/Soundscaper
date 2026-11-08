/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

async function fixture(release: number, duplicate = true) {
	const owner = midiServiceFixture();
	const [created] = await owner.service.importDocument(parseMidiFile(writeMidiFile({
		sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [{
			name: 'Pedal', durationFrames: 16000,
			notes: [{ id: 'note', channel: 0, pitch: 69, velocity: 100, startFrame: 0, durationFrames: 2000 }],
			events: [{ frame: 0, status: 176, data: [64, 127] }, { frame: release, status: 176, data: [64, 0] }],
		}],
	}), { sampleRate: 8000 }));
	assert.ok(created);
	assert.ok(created.trackId, 'the timeline import has a track owner');
	await owner.service.resizeClip(created.clipId, { timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 4000 });
	const clip = owner.project().clips[0]; assert.ok(clip);
	if (duplicate) owner.apply({ type: 'clip/add', trackId: created.trackId,
		clip: { ...clip, id: 'second-copy', timelineStartFrame: 16000 } });
	return { ...owner, trackId: created.trackId };
}

for (const format of ['midi', 'allegro'] as const) for (const release of [4000, 12000]) {
	test(`${format} refuses an unclosed sustained voice at an earlier clip boundary (${release})`, async () => {
		const owner = await fixture(release);
		const before = owner.project();
		await assert.rejects(owner.service.exportFile(format), /sustain.*clip boundary/iu);
		assert.equal(owner.saves.length, 0);
		assert.equal(owner.project(), before, 'refusal retains the editable native project');
	});
}

test('a pedal release inside the clip keeps the normal MIDI delivery and gap', async () => {
	const owner = await fixture(3000);
	await owner.service.exportFile('midi');
	const bytes = owner.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const reopened = midiServiceFixture();
	await reopened.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	const clip = reopened.project().clips[0]; assert.ok(clip);
	assert.ok(reopened.pcm.get(clip.sourceId)?.[0]?.slice(8000, 9000).every(value => value === 0));
});

test('the final file boundary still permits its ordinary sustained ending', async () => {
	const owner = await fixture(12000, false);
	await owner.service.exportFile('midi');
	assert.equal(owner.saves.length, 1);
});

for (const channel of [0, 1]) test(`a boundary release on channel ${channel} only closes its own voices`, async () => {
	const owner = await fixture(12000, false);
	const [peer] = await owner.service.importDocument({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{
		name: 'Release', durationFrames: 4000,
		notes: [{ id: 'peer', channel, pitch: 72, velocity: 100, startFrame: 0, durationFrames: 4000 }],
		events: [{ frame: 0, status: 176 | channel, data: [64, 0] }],
	}] }, { timelineStartFrame: 4000 });
	assert.ok(peer);
	owner.apply({ type: 'clip/move', clipId: peer.clipId, trackId: owner.trackId, timelineStartFrame: 4000 });
	if (channel === 0) {
		await owner.service.exportFile('midi');
		assert.equal(owner.saves.length, 1);
	} else await assert.rejects(owner.service.exportFile('midi'), /sustain.*clip boundary/iu);
});

test('a local boundary pedal release also closes an imported same-onset mode release', async () => {
	const body = [0, 176, 64, 127, 0, 144, 69, 100, 0, 176, 123, 0,
		0x8b, 0x20, 176, 64, 0, 0x83, 0x60, 255, 47, 0];
	const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, 0, body.length, ...body]);
	const owner = midiServiceFixture();
	const [created] = await owner.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	assert.ok(created);
	assert.ok(created.trackId, 'the timeline import has a track owner');
	await owner.service.resizeClip(created.clipId, { timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 4000 });
	const [peer] = await owner.service.importDocument({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{
		name: 'Release', durationFrames: 4000,
		notes: [{ id: 'peer', channel: 0, pitch: 72, velocity: 100, startFrame: 0, durationFrames: 4000 }],
		events: [{ frame: 0, status: 176, data: [64, 0] }],
	}] }, { timelineStartFrame: 4000 });
	assert.ok(peer);
	owner.apply({ type: 'clip/move', clipId: peer.clipId, trackId: created.trackId, timelineStartFrame: 4000 });
	await owner.service.exportFile('midi');
	const delivered = owner.saves[0]?.bytes; assert.ok(delivered instanceof Uint8Array);
	const note = parseMidiFile(delivered, { sampleRate: 8000 }).tracks.flatMap(track => track.notes).find(note => note.pitch === 69);
	assert.equal(note?.onsetStop?.kind, 'all-notes-off');
	assert.ok(note?.onsetStop?.kind === 'all-notes-off');
	assert.equal(note.onsetStop.soundEndFrame, 4000);
});
