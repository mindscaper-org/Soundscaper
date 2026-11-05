/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

function midi(retrigger = false): Uint8Array<ArrayBuffer> {
	const track = [0, 0xb0, 64, 127, 0, 0x90, 60, 100, 0, 0xb0, 120, 0,
		...(retrigger ? [0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, 0] : []),
		0x83, 0x60, 0xb0, 64, 0, 0, 255, 47, 0];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, track.length >> 8, track.length & 255, ...track]);
}

for (const retrigger of [false, true]) test(`MIDI onset panic retains its authored silent note and same-pitch retrigger (retrigger ${String(retrigger)})`, async () => {
	const file = new File([midi(retrigger)], 'Panic.mid');
	const parsed = parseMidiFile(await file.arrayBuffer(), { sampleRate: 8000 });
	assert.deepEqual(parsed.tracks[0]?.notes[0]?.onsetStop, { kind: 'all-sound-off', frame: 0, channel: 0 });
	const f = midiServiceFixture();
	await f.service.importDocument(parsed);
	const clip = f.project().clips[0]; assert.ok(clip);
	assert.equal(readMidiClip(clip)?.notes[0]?.velocity, 100);
	await f.service.setInstrument(f.project().tracks[0]!.id, 'square');
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const notes = parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.notes);
	assert.deepEqual(notes[0]?.onsetStop, { kind: 'all-sound-off', frame: 0, channel: 0 });
	assert.equal(notes[0]?.velocity, 100);
	assert.equal(notes.length, retrigger ? 2 : 1);
	assert.equal(notes[1]?.onsetStop, undefined);
	if (retrigger) assert.deepEqual([notes[1]?.startFrame, notes[1]?.durationFrames, notes[1]?.velocity], [0, 4000, 90]);
	const second = midiServiceFixture();
	await second.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	await second.service.setInstrument(second.project().tracks[0]!.id, 'square');
	const channels = second.pcm.get(second.project().clips[0]!.sourceId); assert.ok(channels);
	const energy = channels[0]!.slice(1, 1000).reduce((sum, value) => sum + value * value, 0);
	assert.equal(energy > 0, retrigger);
	await assert.rejects(f.service.exportFile('allegro'), /Allegro|onset|same.frame/iu);
});

test('moving and reversing a retained onset panic project maps its stop to the same exported source instant', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(midi(), { sampleRate: 8000 }));
	const clip = f.project().clips[0]; assert.ok(clip);
	f.apply({ type: 'clip/move', clipId: clip.id, timelineStartFrame: 8000 });
	f.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true } });
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const note = parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.notes)[0]; assert.ok(note);
	assert.deepEqual(note.onsetStop, { kind: 'all-sound-off', frame: note.startFrame, channel: note.channel });
	assert.equal(note.startFrame, 24_000);
	assert.ok(writeMidiFile(parseMidiFile(bytes, { sampleRate: 8000 })).length > 0);
});
