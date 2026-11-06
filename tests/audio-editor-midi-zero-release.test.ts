/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import type { MidiFileDocument } from '../src/common/editor/midi-file-types.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

function raw(zero: boolean, releaseVelocity = 0, endDelta = 16): Uint8Array<ArrayBuffer> {
	// Standard 480 PPQ / 4 BPM: one input tick is1500 native48kHz frames.
	const events = [0, 255, 81, 3, 0xe4, 0xe1, 0xc0, 0, 144, 60, 100,
		zero ? 0 : 1, 128, 60, releaseVelocity, endDelta - (zero ? 0 : 1), 255, 47, 0];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
}

const peak = (values: Float32Array): number => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);

for (const zero of [false, true]) for (const releaseVelocity of [0, 81]) test(`public import/export preserves immediate release: zero=${zero}, velocity=${releaseVelocity}`, async () => {
	const fixture = midiServiceFixture({ sampleRate: 48_000 });
	const importer = createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('MIDI must use its importer') }, async () => fixture.service);
	await importer.importFiles([new File([raw(zero, releaseVelocity)], 'Release.mid')]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	const clip = fixture.project().clips[0]; assert.ok(clip);
	const note = readMidiClip(clip)?.notes[0]; assert.ok(note);
	assert.equal(note.durationFrames, zero ? 1 : 1500);
	const before = fixture.pcm.get(clip.sourceId)?.[0]; assert.ok(before);
	assert.equal(peak(before) === 0, zero);
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const parsed = parseMidiFile(bytes, { sampleRate: 48_000 });
	const next = parsed.tracks.flatMap(track => track.notes)[0]; assert.ok(next);
	assert.equal(next.durationFrames, note.durationFrames);
	assert.equal(next.releaseVelocity ?? 0, releaseVelocity);
	const reopened = midiServiceFixture({ sampleRate: 48_000 }); await reopened.service.importDocument(parsed);
	const afterClip = reopened.project().clips[0]; assert.ok(afterClip);
	const after = reopened.pcm.get(afterClip.sourceId)?.[0]; assert.ok(after);
	assert.equal(peak(after), peak(before));
	assert.equal(afterClip.durationFrames, 24_000);
});

test('an immediate release with End-of-Track at zero retains its bounded one-sample silent clip', async () => {
	const fixture = midiServiceFixture({ sampleRate: 48_000 });
	await fixture.service.importDocument(parseMidiFile(raw(true, 0, 0), { sampleRate: 48_000 }));
	assert.equal(fixture.project().clips[0]?.durationFrames, 1);
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const parsed = parseMidiFile(bytes, { sampleRate: 48_000 });
	assert.equal(parsed.tracks.flatMap(track => track.notes)[0]?.durationFrames, 1);
	assert.ok(parsed.tracks.every(track => track.durationFrames === 0));
	const reopened = midiServiceFixture({ sampleRate: 48_000 }); await reopened.service.importDocument(parsed);
	assert.equal(reopened.project().clips[0]?.durationFrames, 1);
	const clip = reopened.project().clips[0]; assert.ok(clip);
	const pcm = reopened.pcm.get(clip.sourceId)?.[0]; assert.ok(pcm);
	assert.equal(pcm.length, 1); assert.equal(peak(pcm), 0);
});

test('a normal authored one-sample note does not grow into an audible export tick', async () => {
	const fixture = midiServiceFixture({ sampleRate: 48_000 });
	const { clipId } = await fixture.service.addTrack();
	await fixture.service.addNote(clipId, { id: 'one', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 1 });
	fixture.apply({ type: 'tempo/set', bpm: 4 });
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const parsed = parseMidiFile(bytes, { sampleRate: 48_000 });
	assert.equal(parsed.tracks.flatMap(track => track.notes)[0]?.durationFrames, 1);
});

function document(overrides: Partial<MidiFileDocument['tracks'][number]> = {}): MidiFileDocument {
	return { sampleRate: 48_000, tempos: [{ frame: 0, bpm: 4 }], signatures: [], tracks: [{ name: 'Keys', durationFrames: 24_000, notes: [
		{ id: 'old', pitch: 60, channel: 0, velocity: 90, startFrame: 0, durationFrames: 750 },
		{ id: 'zero', pitch: 60, channel: 0, velocity: 100, startFrame: 750, durationFrames: 1 },
		{ id: 'new', pitch: 60, channel: 0, velocity: 70, startFrame: 750, durationFrames: 1500 },
		{ id: 'other', pitch: 64, channel: 0, velocity: 80, startFrame: 750, durationFrames: 1500 },
	], ...overrides }] };
}

for (const pedal of [false, true]) test(`old key release, coincident zero pair and new same-pitch note stay owned: pedal=${pedal}`, () => {
	const source = document(pedal ? { events: [{ frame: 0, status: 176, data: [64, 127] }, { frame: 6000, status: 176, data: [64, 0] }] } : {});
	const track = source.tracks[0]; assert.ok(track);
	const parsed = parseMidiFile(writeMidiFile(source), { sampleRate: 48_000 });
	const actual = parsed.tracks.find(candidate => candidate.notes.length); assert.ok(actual);
	assert.deepEqual(actual.notes.map(note => [note.pitch, note.startFrame, note.durationFrames, note.velocity]), track.notes.map(note => [note.pitch, note.startFrame, note.durationFrames, note.velocity]));
	assert.deepEqual(renderMidiFrames(actual.notes, 'triangle', 48_000, 0, 12_000, actual.events), renderMidiFrames(track.notes, 'triangle', 48_000, 0, 12_000, track.events));
});

test('coincident zero pairs keep independent channel and explicit port destinations', () => {
	const source = document({ notes: [{ id: 'zero', pitch: 60, channel: 0, velocity: 100, startFrame: 0, durationFrames: 1, midiPort: 0 },
		{ id: 'other', pitch: 60, channel: 1, velocity: 90, startFrame: 0, durationFrames: 1500, midiPort: 1 }],
		events: [{ frame: 0, status: 255, metaType: 33, data: [1] }, { frame: 0, status: 176, data: [7, 0] }],
	});
	const track = source.tracks[0]; assert.ok(track);
	const parsed = parseMidiFile(writeMidiFile(source), { sampleRate: 48_000 });
	const actual = parsed.tracks.find(candidate => candidate.notes.length); assert.ok(actual);
	assert.deepEqual(actual.notes.map(note => [note.channel, note.midiPort, note.durationFrames]), [[0, 0, 1], [1, 1, 1500]]);
	assert.deepEqual(renderMidiFrames(actual.notes, 'triangle', 48_000, 0, 12_000, actual.events), renderMidiFrames(track.notes, 'triangle', 48_000, 0, 12_000, track.events));
});

test('complete multipart SysEx stays together before an immediate release pair', () => {
	const source = document({ notes: [{ id: 'zero', pitch: 60, channel: 0, velocity: 100, startFrame: 0, durationFrames: 1 }],
		events: [{ frame: 0, status: 240, data: [67, 18, 0] }, { frame: 0, status: 247, data: [67, 0, 247] }],
	});
	const parsed = parseMidiFile(writeMidiFile(source), { sampleRate: 48_000 });
	assert.equal(parsed.tracks.flatMap(track => track.notes)[0]?.durationFrames, 1);
	assert.deepEqual(parsed.tracks.flatMap(track => track.events ?? []).filter(event => event.status === 240 || event.status === 247).map(event => event.status), [240, 247]);
});
