/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';
import { initialMeterMidi } from './helpers/midi-initial-meter-fixture.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { firstMidiClip, keyQueueMidi, midiNotes, panicMidi, programMidi, rawMidi, scopedLyricMidi } from './helpers/midi-chronology-custody-fixtures.ts';

for (const [frames, ending] of [[24_000, '8170'], [144_000, '9450']] as const) test(`declared MIDI ending${frames} survives actual controller synthesis, source storage and portable reopening`, async context => {
	const runtime = await midiImportArchiveCustody(context);
	const body = Uint8Array.from(Buffer.from(`00ff510307a12000903c648170803c00${ending}ff2f00`, 'hex'));
	await runtime.controller.actions.project.importFiles([new File([rawMidi(body)], 'One phrase.mid')]);
	const recipient = await runtime.reopen();
	const clip = firstMidiClip(recipient.project);
	assert.equal(clip.durationFrames, frames);
	assert.deepEqual(midiNotes(recipient.project).map(note => [note.startFrame, note.durationFrames, note.pitch, note.velocity]), [[0, 12_000, 60, 100]]);
	const source = recipient.project.sources.find(source => source.id === clip.sourceId); assert.ok(source?.kind === 'audio');
	assert.equal(source.frameCount, frames);
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	assert.ok(samples.slice(144, 11_000).some(sample => Math.abs(sample) > .05));
	assert.ok(samples.slice(12_000).every(sample => sample === 0));
});

test('the final initial MIDI meter, later change and exact note clock survive actual project/archive and MIDI delivery', async context => {
	const runtime = await midiImportArchiveCustody(context);
	await runtime.controller.actions.project.importFiles([new File([initialMeterMidi()], 'Initial meters.mid')]);
	const recipient = await runtime.reopen();
	assert.deepEqual(recipient.project.tempo.timeSignature, { numerator: 4, denominator: 4 });
	await recipient.controller.actions.midi.exportFile('midi');
	const output = runtime.saved.at(-1)?.bytes; assert.ok(output instanceof Uint8Array);
	const document = parseMidiFile(output, { sampleRate: 48_000 });
	assert.deepEqual(document.signatures, [
		{ frame: 0, numerator: 4, denominator: 4, clocksPerMetronomeClick: 36, notated32ndNotesPerQuarter: 12 },
		{ frame: 24_000, numerator: 6, denominator: 8, clocksPerMetronomeClick: 72 },
	]);
	assert.equal(document.tracks.flatMap(track => track.notes)[0]?.durationFrames, 48_000);
});

for (const burst of [false, true]) test(`10000 real MIDI key releases burst=${burst} preserve literal notes and complete PCM through the actual controller/archive`, async context => {
	const runtime = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => 'silent' });
	await runtime.controller.actions.project.importFiles([new File([keyQueueMidi(burst)], 'Ten thousand keys.mid')]);
	const recipient = await runtime.reopen();
	assert.equal(recipient.project.clips.length, 1);
	const notes = midiNotes(recipient.project);
	assert.equal(notes.length, 10_000);
	assert.ok(notes.every(note => note.pitch === 60 && note.velocity === 90 && note.releaseVelocity === 64 && note.durationFrames === 1));
	assert.equal(notes[0]?.startFrame, 0);
	assert.equal(notes.at(-1)?.startFrame, burst ? 0 : 7324);
});

for (const trim of [0, 24_000]) test(`literal RPN reset chronology survives real MIDI source trim${trim}, portable storage and delivery`, async context => {
	const setup = [[0, 101, 0], [0, 100, 0], [6000, 121, 0], [12_000, 96, 0], [18_000, 121, 0]];
	const bytes = writeMidiFile({ sampleRate: 48_000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [{ name: 'RPN reset boundaries',
		events: setup.map(([frame, cc, value]) => ({ frame: frame!, status: 176, data: [cc!, value!] })),
		notes: [{ id: 'key', startFrame: 48_000, durationFrames: 48_000, pitch: 60, channel: 0, velocity: 100 }],
	}] });
	const runtime = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => 'audible' });
	await runtime.controller.actions.project.importFiles([new File([bytes], 'RPN resets.mid')]);
	const clip = firstMidiClip(runtime.controller.project);
	const duration = clip.durationFrames; assert.ok(typeof duration === 'number' && Number.isSafeInteger(duration));
	if (trim) await runtime.controller.actions.midi.resizeClip(clip.id, { timelineStartFrame: 0, sourceStartFrame: trim, durationFrames: duration - trim });
	const recipient = await runtime.reopen();
	assert.equal(firstMidiClip(recipient.project).sourceStartFrame, trim);
	assert.deepEqual(readMidiClip(firstMidiClip(recipient.project))?.interchange?.events.filter(event => event.status === 176).map(event => [event.frame, ...event.data]),
		[[0, 101, 0], [0, 100, 0], [6000, 121, 0], [12_000, 96, 0], [18_000, 121, 0]]);
	await recipient.controller.actions.midi.exportFile('midi');
	const output = runtime.saved.at(-1)?.bytes; assert.ok(output instanceof Uint8Array);
	assert.deepEqual(parseMidiFile(output, { sampleRate: 48_000 }).tracks.flatMap(track => track.events ?? []).filter(event => event.status === 176).map(event => event.data),
		[[101, 0], [100, 0], [121, 0], [96, 0], [121, 0]]);
});

test('a later program change stays after its original onset through actual controller, archive and delivered bytes', async context => {
	const runtime = await midiImportArchiveCustody(context);
	await runtime.controller.actions.project.importFiles([new File([programMidi(120)], 'Later patch.mid')]);
	const recipient = await runtime.reopen();
	assert.deepEqual(midiNotes(recipient.project).map(note => [note.startFrame, note.pitch, note.velocity]), [[0, 60, 100]]);
	await recipient.controller.actions.midi.exportFile('midi');
	const output = runtime.saved.at(-1)?.bytes; assert.ok(output instanceof Uint8Array);
	const bytes = Buffer.from(output);
	const onset = bytes.indexOf(Buffer.from([144, 60, 100]));
	assert.ok(onset > 0); assert.ok(bytes.indexOf(Buffer.from([192, 10])) > onset);
	const delivered = parseMidiFile(output, { sampleRate: 48_000 });
	assert.deepEqual(delivered.tracks.flatMap(track => track.events ?? []).filter(event => event.status === 192).map(event => [event.frame, ...event.data]), [[0, 5], [6000, 10]]);
});

for (const trim of [0, 12_000]) test(`pending lyric scope survives actual controller source trim${trim}, native document storage and MIDI delivery`, async context => {
	const runtime = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => 'audible' });
	await runtime.controller.actions.project.importFiles([new File([scopedLyricMidi()], 'Scoped lyric.mid')]);
	const clip = firstMidiClip(runtime.controller.project);
	const duration = clip.durationFrames; assert.ok(typeof duration === 'number' && Number.isSafeInteger(duration));
	if (trim) await runtime.controller.actions.midi.resizeClip(clip.id, { timelineStartFrame: 0, sourceStartFrame: trim, durationFrames: duration - trim });
	const recipient = await runtime.reopen();
	assert.equal(firstMidiClip(recipient.project).sourceStartFrame, trim);
	const events = readMidiClip(firstMidiClip(recipient.project))?.interchange?.events ?? [];
	assert.deepEqual(events.filter(event => event.metaType === 5).map(event => [event.frame, event.data, event.textChannel]), [[24_000, [104, 105], 2]]);
	await recipient.controller.actions.midi.exportFile('midi');
	const output = runtime.saved.at(-1)?.bytes; assert.ok(output instanceof Uint8Array);
	const delivered = parseMidiFile(output, { sampleRate: 48_000 }).tracks.flatMap(track => track.events ?? []);
	assert.deepEqual(delivered.filter(event => event.metaType === 5).map(event => event.data), [[104, 105]]);
	assert.deepEqual(delivered.filter(event => event.metaType === 32).map(event => event.data), [[2]]);
});

for (const delta of [0, 1, 3]) test(`quantized panic${delta} retains its exact bounded voice tail through actual synthesis, archive and MIDI delivery`, async context => {
	const runtime = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => delta < 3 ? 'silent' : { assertSamples: assertShortPanicPcm } });
	await runtime.controller.actions.project.importFiles([new File([panicMidi(delta)], 'Killed voice.mid')]);
	const recipient = await runtime.reopen();
	const clip = firstMidiClip(recipient.project);
	assert.equal(midiNotes(recipient.project).length, 1);
	const source = recipient.project.sources.find(source => source.id === clip.sourceId); assert.ok(source?.kind === 'audio');
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	assert.ok(samples.slice(512, 4608).every(sample => sample === 0));
	assert.ok(samples.slice(2).every(sample => sample === 0));
	await recipient.controller.actions.midi.exportFile('midi');
	const output = runtime.saved.at(-1)?.bytes; assert.ok(output instanceof Uint8Array);
	const delivered = parseMidiFile(output, { sampleRate: 48_000 });
	assert.equal(delivered.tracks.flatMap(track => track.notes).length, 1);
	const imported = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => delta < 3 ? 'silent' : { assertSamples: assertDeliveredPanicPcm } });
	await imported.controller.actions.project.importFiles([new File([Uint8Array.from(output)], 'Delivered killed voice.mid')]);
	const portable = await imported.reopen();
	const after = firstMidiClip(portable.project);
	const afterSource = portable.project.sources.find(source => source.id === after.sourceId); assert.ok(afterSource?.kind === 'audio');
	assert.ok((await readCustodyPcm(portable.store, afterSource))[0]?.slice(512, 4608).every(sample => sample === 0));
});

function assertShortPanicPcm(channels: readonly (readonly number[])[]): void {
	assert.equal(channels.length, 1);
	const samples = channels[0]; assert.ok(samples && samples.length > 4608);
	assert.equal(samples[0], 0);
	// Three32767-PPQ ticks stop the48k source at frame2: only frame1 can
	// contain the tiny triangle attack, and every later sample is exactly zero.
	assert.ok(Math.abs(samples[1] ?? 0) > .0001 && Math.abs(samples[1] ?? 0) < .001);
	assert.ok(samples.slice(2).every(sample => sample === 0));
}

function assertDeliveredPanicPcm(channels: readonly (readonly number[])[]): void {
	assert.equal(channels.length, 1);
	const samples = channels[0]; assert.ok(samples && samples.length > 4608);
	assert.equal(samples[0], 0);
	// The writer retains a positive stop on its480-PPQ clock: one tick at
	//120BPM is50samples. It may not become the much later pedal release.
	assert.ok(samples.slice(1, 50).some(sample => sample !== 0));
	assert.ok(samples.slice(50).every(sample => sample === 0));
}
