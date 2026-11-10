/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';
import { exactWave } from './helpers/midi-fourth-custody-fixtures.ts';
import { midiProject } from './helpers/midi-chronology-custody-fixtures.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';

for (const split of [false, true]) test(`actual MIDI velocity publication split=${split} preserves literal source planes, mono gain and independent archive PCM`, async context => {
	const silentSources = new Set<string>();
	const fixture = await midiImportArchiveCustody(context, { sourcePcmExpectation: source => silentSources.has(source.id) ? 'silent' : 'audible' });
	await fixture.controller.actions.project.importFiles([exactWave('Stereo bed.wav', [new Float32Array(48_000).fill(.125), new Float32Array(48_000).fill(-.25)])]);
	const imported = midiProject(fixture.controller.project);
	const bedSource = imported.sources.find(source => source.name === 'Stereo bed.wav'); assert.ok(bedSource?.kind === 'audio');
	const bedClip = imported.clips.find(clip => clip.sourceId === bedSource.id); assert.ok(bedClip);
	const bed = imported.tracks.find(track => track.type === 'audio' && track.clipIds.includes(bedClip.id)); assert.ok(bed?.type === 'audio');
	const added = await fixture.controller.actions.midi.addTrack();
	for (const source of midiProject(fixture.controller.project).sources) if (source.name !== 'Stereo bed.wav') silentSources.add(source.id);
	await fixture.controller.actions.midi.addNote(added.clipId, { id: 'authored-note', pitch: 69, velocity: 100, channel: 0, startFrame: 0, durationFrames: 4800 });
	await fixture.controller.actions.clip.move(added.clipId, bed.id, 144_000, { exactFrame: true });
	const before = structuredClone(midiProject(fixture.controller.project));
	const original = before.clips.find(clip => clip.id === added.clipId); assert.ok(original);
	const authoredTrack = readMidiTrack(before.tracks.find(track => track.id === bed.id)); assert.ok(authoredTrack);
	const originalSource = before.sources.find(source => source.id === original.sourceId); assert.ok(originalSource?.kind === 'audio');
	const baseline = (await readCustodyPcm(fixture.store, originalSource))[0]; assert.ok(baseline);
	const rms = (samples: Float32Array) => Math.sqrt(samples.slice(1200, 3600).reduce((sum, sample) => sum + sample * sample, 0) / 2400);
	assert.ok(rms(baseline) > .02);
	let rightClipId: string | undefined;
	if (split) {
		const undoCount = fixture.controller.getSnapshot().history.undoEntries.length;
		const result = await fixture.controller.actions.track.splitStereoLR(bed.id); assert.ok(result);
		const after = structuredClone(midiProject(fixture.controller.project));
		assert.equal(after.clips.length, 4); assert.equal(after.sources.length, 3);
		assert.equal(after.sources.filter(source => !before.sources.some(original => original.id === source.id)).length, 2);
		const notes = after.clips.filter(clip => readMidiClip(clip)); assert.equal(notes.length, 2);
		for (const clip of notes) { assert.equal(clip.sourceId, original.sourceId); assert.equal(clip.gain, Math.SQRT1_2); assert.equal(clip.timelineStartFrame, 144_000); }
		const right = notes.find(clip => clip.id !== added.clipId); assert.ok(right); rightClipId = right.id;
		const leftTrack = after.tracks.find(track => track.id === result.leftTrackId); assert.ok(leftTrack?.type === 'audio');
		const rightTrack = after.tracks.find(track => track.id === result.rightTrackId); assert.ok(rightTrack?.type === 'audio');
		assert.ok(leftTrack.clipIds.includes(added.clipId)); assert.ok(rightTrack.clipIds.includes(right.id));
		assert.equal(fixture.controller.getSnapshot().history.undoEntries.length, undoCount + 1);
		await fixture.controller.actions.edit.undo();
		assert.deepEqual(fixture.controller.project?.clips, before.clips); assert.deepEqual(fixture.controller.project?.tracks, before.tracks);
		await fixture.controller.actions.edit.redo();
		assert.deepEqual(fixture.controller.project?.clips, after.clips); assert.deepEqual(fixture.controller.project?.tracks, after.tracks);
	}
	await fixture.controller.actions.midi.updateNote(added.clipId, 'authored-note', { velocity: 99 });
	const recipient = await fixture.reopen();
	const edited = recipient.project.clips.find(clip => clip.id === added.clipId); assert.ok(edited);
	assert.equal(edited.gain, split ? Math.SQRT1_2 : 1); assert.equal(edited.timelineStartFrame, 144_000);
	assert.deepEqual(readMidiClip(edited)?.notes.map(note => [note.id, note.pitch, note.velocity, note.startFrame, note.durationFrames]), [['authored-note', 69, 99, 0, 4800]]);
	const track = recipient.project.tracks.find(track => track.type === 'audio' && track.clipIds.includes(edited.id)); assert.ok(track);
	assert.deepEqual(readMidiTrack(track)?.instrument, authoredTrack.instrument);
	const source = recipient.project.sources.find(source => source.id === edited.sourceId); assert.ok(source?.kind === 'audio');
	assert.notEqual(source.id, original.sourceId); assert.equal(source.channelCount, 1); assert.equal(source.frameCount, 384_000);
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	assert.ok(Math.abs(rms(samples) / rms(baseline) - .99) < .0001, '99/100 authored velocity independently scales the newly published raw mono source');
	if (split) {
		const right = recipient.project.clips.find(clip => clip.id === rightClipId); assert.ok(right);
		assert.equal(right.sourceId, original.sourceId); assert.equal(right.gain, Math.SQRT1_2);
		assert.equal(readMidiClip(right)?.notes[0]?.velocity, 100);
		const ordinary = recipient.project.clips.filter(clip => !readMidiClip(clip)); assert.equal(ordinary.length, 2);
		for (const clip of ordinary) {
			const source = recipient.project.sources.find(source => source.id === clip.sourceId); assert.ok(source?.kind === 'audio');
			assert.equal(source.channelCount, 1); assert.equal(source.frameCount, 48_000);
			const owner = recipient.project.tracks.find(track => track.type === 'audio' && track.clipIds.includes(clip.id)); assert.ok(owner?.type === 'audio');
			const expected = owner.clipIds.includes(added.clipId) ? .125 : -.25;
			assert.ok((await readCustodyPcm(recipient.store, source))[0]?.every(sample => sample === expected));
		}
	} else {
		const source = recipient.project.sources.find(source => source.name === 'Stereo bed.wav'); assert.ok(source?.kind === 'audio');
		assert.equal(source.channelCount, 2);
		const planes = await readCustodyPcm(recipient.store, source);
		assert.ok(planes[0]?.every(sample => sample === .125)); assert.ok(planes[1]?.every(sample => sample === -.25));
	}
});
