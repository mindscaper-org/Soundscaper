/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { firstMidiClip, midiNotes, midiProject, releaseMidi, sustainMidi } from './helpers/midi-chronology-custody-fixtures.ts';

for (const zero of [false, true]) test(`immediate release zero=${zero} retains literal duration and real synthesized PCM through independent Scape and MIDI reopening`, async context => {
	const runtime = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => zero ? 'silent' : 'audible' });
	await runtime.controller.actions.project.importFiles([new File([releaseMidi(zero)], 'Release.mid')]);
	const recipient = await runtime.reopen();
	assert.deepEqual(midiNotes(recipient.project).map(note => [note.startFrame, note.durationFrames, note.pitch, note.velocity]),
		[[0, zero ? 1 : 1500, 60, 100]]);
	const clip = firstMidiClip(recipient.project);
	assert.equal(clip.durationFrames, 24_000);
	const source = recipient.project.sources.find(source => source.id === clip.sourceId); assert.ok(source?.kind === 'audio');
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	assert.equal(samples.length, 24_000);
	if (zero) assert.ok(samples.every(sample => sample === 0));
	else assert.ok(samples.slice(144, 1200).some(sample => Math.abs(sample) > .05));
	assert.ok(samples.slice(1500).every(sample => sample === 0));
	await recipient.controller.actions.midi.exportFile('midi');
	const bytes = runtime.saved.at(-1)?.bytes; assert.ok(bytes instanceof Uint8Array);
	const delivered = parseMidiFile(bytes, { sampleRate: 48_000 });
	assert.deepEqual(delivered.tracks.flatMap(track => track.notes).map(note => [note.startFrame, note.durationFrames, note.pitch, note.velocity]),
		[[0, zero ? 1 : 1500, 60, 100]]);
	const reopened = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => zero ? 'silent' : 'audible' });
	await reopened.controller.actions.project.importFiles([new File([Uint8Array.from(bytes)], 'Delivered.mid')]);
	const portable = await reopened.reopen();
	const afterClip = firstMidiClip(portable.project);
	const afterSource = portable.project.sources.find(source => source.id === afterClip.sourceId); assert.ok(afterSource?.kind === 'audio');
	assert.deepEqual((await readCustodyPcm(portable.store, afterSource))[0], samples);
});

for (const donorNotes of [false, true]) test(`foreign CC7 mute donorNotes=${donorNotes} reaches the literal Peer source through actual synthesis/store/Scape`, async context => {
	const note = { id: 'n', pitch: 69, channel: 1, velocity: 100, startFrame: 0, durationFrames: 48_000 };
	const bytes = writeMidiFile({ sampleRate: 48_000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [
		{ name: 'Donor', notes: donorNotes ? [{ ...note, id: 'a', channel: 0, pitch: 57 }] : [],
			events: [{ frame: 0, status: 177, data: [7, 0] }], durationFrames: 48_000 },
		{ name: 'Peer', notes: [note], durationFrames: 48_000 },
	] });
	// The fixture's channel1 CC7=0 requires Peer silence independently of the
	// resulting document. Source IDs merely locate that authored named lane.
	const runtime = await midiImportArchiveCustody(context, { sourcePcmExpectation: (source, project) =>
		project.clips.some(clip => clip.sourceId === source.id && clip.title === 'Peer') ? 'silent' : 'audible' });
	await runtime.controller.actions.project.importFiles([new File([bytes], 'Separate controls.mid')]);
	const recipient = await runtime.reopen();
	assert.deepEqual(recipient.project.clips.map(clip => clip.title), donorNotes ? ['Donor', 'Peer'] : ['Peer']);
	const peer = recipient.project.clips.find(clip => clip.title === 'Peer'); assert.ok(peer);
	assert.deepEqual(readMidiClip(peer)?.notes.map(note => [note.channel, note.pitch, note.startFrame, note.durationFrames]), [[1, 69, 0, 48_000]]);
	const source = recipient.project.sources.find(source => source.id === peer.sourceId); assert.ok(source?.kind === 'audio');
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	assert.ok(samples.every(sample => sample === 0));
});

for (const order of ['before', 'later'] as const) test(`sustain ${order} retains independently expected real source attack/release windows through portable reopening`, async context => {
	const runtime = await midiImportArchiveCustody(context);
	await runtime.controller.actions.project.importFiles([new File([sustainMidi(order)], 'Key and pedal order.mid')]);
	const recipient = await runtime.reopen();
	assert.deepEqual(midiNotes(recipient.project).map(note => [note.startFrame, note.durationFrames, note.pitch, note.velocity]), [[0, 48_000, 69, 100]]);
	const clip = firstMidiClip(recipient.project);
	// The retained pedal-up event at frame72000 owns one final stored frame.
	assert.equal(clip.durationFrames, 72_001);
	const source = recipient.project.sources.find(source => source.id === clip.sourceId); assert.ok(source?.kind === 'audio');
	assert.equal(source.frameCount, 72_001);
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	assert.ok(samples.slice(144, 47_000).some(sample => Math.abs(sample) > .05));
	if (order === 'before') assert.ok(samples.slice(52_800, 60_000).some(sample => Math.abs(sample) > .05));
	else assert.ok(samples.slice(48_000).every(sample => sample === 0));
	assert.ok(samples.slice(72_000).every(sample => sample === 0));
});

for (const finalVolume of [0, 127]) test(`independent second clip after CC7=${finalVolume} retains actual PCM, move ownership and literal delivered reset`, async context => {
	const note = { id: 'n', pitch: 69, channel: 0, velocity: 100, startFrame: 0, durationFrames: 24_000 };
	const input = (name: string, volume: number | null) => writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name,
		notes: [note], durationFrames: name === 'First' ? 48_000 : 24_000,
		...(volume === null ? {} : { events: [{ frame: 0, status: 176, data: [7, 127] }, { frame: 36_000, status: 176, data: [7, volume] }] }),
	}] });
	const runtime = await midiImportArchiveCustody(context);
	await runtime.controller.actions.project.importFiles([new File([input('First', finalVolume)], 'First.mid'), new File([input('Second', null)], 'Second.mid')]);
	const project = midiProject(runtime.controller.project);
	const first = project.clips.find(clip => clip.title === 'First'), second = project.clips.find(clip => clip.title === 'Second'); assert.ok(first && second);
	const track = project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(first.id)); assert.ok(track);
	await runtime.controller.actions.clip.move(second.id, track.id, 96_000, { exactFrame: true });
	const recipient = await runtime.reopen();
	const moved = recipient.project.clips.find(clip => clip.id === second.id); assert.ok(moved?.kind === 'audio');
	assert.equal(moved.timelineStartFrame, 96_000);
	assert.deepEqual(recipient.project.tracks.find(candidate => candidate.id === track.id)?.clipIds, [first.id, second.id]);
	const source = recipient.project.sources.find(source => source.id === moved.sourceId); assert.ok(source?.kind === 'audio');
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	assert.ok(samples.slice(144, 23_000).some(sample => Math.abs(sample) > .05));
	await recipient.controller.actions.midi.exportFile('midi');
	const bytes = runtime.saved.at(-1)?.bytes; assert.ok(bytes instanceof Uint8Array);
	const document = parseMidiFile(bytes, { sampleRate: 48_000 });
	const delivered = document.tracks.find(track => track.notes.length); assert.ok(delivered);
	assert.deepEqual(delivered.notes.map(note => [note.startFrame, note.durationFrames, note.pitch]), [[0, 24_000, 69], [96_000, 24_000, 69]]);
	assert.deepEqual((delivered.events ?? []).filter(event => event.frame === 96_000 && event.status === 176 && event.data[0] === 7).map(event => event.data), finalVolume === 0 ? [[7, 127]] : []);
	const imported = await midiImportArchiveCustody(context);
	await imported.controller.actions.project.importFiles([new File([Uint8Array.from(bytes)], 'Delivered independent clips.mid')]);
	const portable = await imported.reopen();
	const after = firstMidiClip(portable.project);
	const afterSource = portable.project.sources.find(source => source.id === after.sourceId); assert.ok(afterSource?.kind === 'audio');
	assert.ok((await readCustodyPcm(portable.store, afterSource))[0]?.slice(96_000, 120_000).some(sample => Math.abs(sample) > .05));
});

for (const release of [3000, 12_000]) test(`actual sustained clip boundary release${release} preserves literal portable gap and faithfully delivers or refuses MIDI`, async context => {
	const runtime = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => 'audible' });
	await runtime.controller.actions.project.create({ sampleRate: 8000 });
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [{ name: 'Pedal', durationFrames: 16_000,
		notes: [{ id: 'note', channel: 0, pitch: 69, velocity: 100, startFrame: 0, durationFrames: 2000 }],
		events: [{ frame: 0, status: 176, data: [64, 127] }, { frame: release, status: 176, data: [64, 0] }],
	}] });
	await runtime.controller.actions.project.importFiles([new File([bytes], 'Pedal.mid')]);
	const clip = firstMidiClip(runtime.controller.project);
	await runtime.controller.actions.midi.resizeClip(clip.id, { timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 4000 });
	const project = midiProject(runtime.controller.project);
	const track = project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id)); assert.ok(track);
	await runtime.controller.actions.clip.move(clip.id, track.id, 16_000, { duplicate: true, exactFrame: true });
	const recipient = await runtime.reopen();
	assert.equal(recipient.project.sampleRate, 8000);
	assert.deepEqual(recipient.project.clips.map(clip => [clip.timelineStartFrame, clip.durationFrames]), [[0, 4000], [16_000, 4000]]);
	const source = recipient.project.sources.find(source => source.id === firstMidiClip(recipient.project).sourceId); assert.ok(source?.kind === 'audio');
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	assert.ok(samples.slice(2100, Math.min(release - 100, 11_000)).some(sample => Math.abs(sample) > .05));
	assert.ok(samples.slice(release).every(sample => sample === 0));
	const before = structuredClone(recipient.project), saves = runtime.saved.length;
	if (release === 12_000) {
		await assert.rejects(recipient.controller.actions.midi.exportFile('midi'), /sustained note cut by a clip boundary/u);
		assert.equal(runtime.saved.length, saves); assert.deepEqual(recipient.controller.project, before);
	} else {
		await recipient.controller.actions.midi.exportFile('midi');
		const delivered = runtime.saved.at(-1)?.bytes; assert.ok(delivered instanceof Uint8Array);
		const document = parseMidiFile(delivered, { sampleRate: 8000 });
		const track = document.tracks.find(track => track.notes.length); assert.ok(track);
		assert.deepEqual(track.notes.map(note => [note.startFrame, note.durationFrames, note.pitch]), [[0, 2000, 69], [16_000, 2000, 69]]);
		assert.equal(track.durationFrames, 20_000);
		const imported = await midiImportArchiveCustody(context);
		await imported.controller.actions.project.create({ sampleRate: 8000 });
		await imported.controller.actions.project.importFiles([new File([Uint8Array.from(delivered)], 'Delivered gap.mid')]);
		const portable = await imported.reopen();
		const after = firstMidiClip(portable.project);
		const afterSource = portable.project.sources.find(source => source.id === after.sourceId); assert.ok(afterSource?.kind === 'audio');
		assert.ok((await readCustodyPcm(portable.store, afterSource))[0]?.slice(8000, 9000).every(sample => sample === 0));
	}
});
