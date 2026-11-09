/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { firstMidiClip, globalLyricMidi, midiNotes, midiProject, programMidi, sustainMidi } from './helpers/midi-chronology-custody-fixtures.ts';

for (const [name, input, diagnostic] of [
	['late program', programMidi(0), /MIDI program order cannot preserve a note onset assignment/u],
	['late sustain', sustainMidi('after'), /sustain and key-release order/u],
] as const) test(`public ${name} refusal precedes service/source allocation and preserves actual persisted project custody`, async context => {
	const runtime = await midiImportArchiveCustody(context);
	const before = structuredClone(midiProject(runtime.controller.project));
	await runtime.controller.actions.project.flush();
	const file = new File([input], 'Unsupported.mid');
	const boundary = createMidiImportFiles({ getProject: () => before, importFiles: () => assert.fail('MIDI must not enter the ordinary audio codec') },
		async () => assert.fail('Rejected source chronology must not load the MIDI service/synthesizer'));
	await assert.rejects(boundary.importFiles([file]), diagnostic);
	const writes = runtime.sourceWriteCount();
	await assert.rejects(runtime.controller.actions.project.importFiles([file]), diagnostic);
	assert.equal(runtime.sourceWriteCount(), writes);
	assert.equal(runtime.saved.length, 0);
	assert.deepEqual(runtime.controller.project, before);
	await runtime.controller.actions.project.flush();
	assert.deepEqual(await runtime.store.loadProject(before.id), before);
});

test('actual project tempo20 refuses lossy MIDI chronology after portable reopening without publication', async context => {
	const runtime = await midiImportArchiveCustody(context);
	await runtime.controller.actions.project.importFiles([new File([programMidi(1, 4800)], 'Retained chronology.mid')]);
	await runtime.controller.actions.project.setTempo(20);
	const recipient = await runtime.reopen();
	assert.equal(recipient.project.tempo.bpm, 20);
	assert.equal(midiNotes(recipient.project).length, 1);
	const before = structuredClone(recipient.project), writes = recipient.sourceWriteCount(), saves = runtime.saved.length;
	await assert.rejects(recipient.controller.actions.midi.exportFile('midi'), /MIDI export cannot preserve program order at a note onset/u);
	assert.equal(recipient.sourceWriteCount(), writes); assert.equal(runtime.saved.length, saves);
	assert.deepEqual(recipient.controller.project, before);
	assert.deepEqual(await recipient.store.loadProject(before.id), before);
});

test('global lyric scope retired by raw NoteOn remains literal through actual archive and refuses invented MIDI association', async context => {
	const runtime = await midiImportArchiveCustody(context);
	await runtime.controller.actions.project.importFiles([new File([globalLyricMidi()], 'Global after onset.mid')]);
	const recipient = await runtime.reopen();
	assert.deepEqual(readMidiClip(firstMidiClip(recipient.project))?.interchange?.events.filter(event => event.metaType === 5)
		.map(event => [event.data, event.textChannel]), [[[104, 105], null]]);
	const before = structuredClone(recipient.project), writes = recipient.sourceWriteCount(), saves = runtime.saved.length;
	await assert.rejects(recipient.controller.actions.midi.exportFile('midi'), /MIDI text channel association cannot be cleared/u);
	assert.equal(recipient.sourceWriteCount(), writes); assert.equal(runtime.saved.length, saves);
	assert.deepEqual(recipient.controller.project, before);
});

test('actual authored nested keys remain editable and portable after MIDI refusal and deliver independent Allegro clocks', async context => {
	const initiallySilent = new Set<string>();
	const runtime = await midiImportArchiveCustody(context, { sourcePcmExpectation: source => initiallySilent.has(source.id) ? 'silent' : 'audible' });
	const created = await runtime.controller.actions.midi.addTrack();
	for (const source of midiProject(runtime.controller.project).sources) initiallySilent.add(source.id);
	await runtime.controller.actions.midi.addNote(created.clipId, { id: 'first', pitch: 60, channel: 0, velocity: 100, startFrame: 0, durationFrames: 24_000 });
	await runtime.controller.actions.midi.addNote(created.clipId, { id: 'nested', pitch: 60, channel: 0, velocity: 60, startFrame: 6000, durationFrames: 6000 });
	const recipient = await runtime.reopen();
	assert.deepEqual(midiNotes(recipient.project).map(note => [note.startFrame, note.durationFrames, note.velocity]), [[0, 24_000, 100], [6000, 6000, 60]]);
	const before = structuredClone(recipient.project), writes = recipient.sourceWriteCount(), saves = runtime.saved.length;
	await assert.rejects(recipient.controller.actions.midi.exportFile('midi'), /MIDI export cannot preserve overlapping notes on the same MIDI key/u);
	assert.equal(runtime.saved.length, saves); assert.equal(recipient.sourceWriteCount(), writes);
	assert.deepEqual(recipient.controller.project, before);
	await recipient.controller.actions.midi.exportFile('allegro');
	const text = runtime.saved.at(-1)?.text; assert.equal(typeof text, 'string');
	assert.deepEqual(parseAllegroFile(String(text), { sampleRate: 48_000 }).tracks.flatMap(track => track.notes)
		.map(note => [note.startFrame, note.durationFrames, note.velocity]), [[0, 24_000, 100], [6000, 6000, 60]]);
});

for (const badFirst of [true, false]) test(`mixed ordinary WAV and corrupt MIDI order badFirst=${badFirst} retains independent actual PCM and portable healthy sibling`, async context => {
	const runtime = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => 'audible' });
	const healthy = new File([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, dither: false }))], 'Healthy.wav', { type: 'audio/wav' });
	const broken = new File(['Not a MIDI file'], 'Broken.mid', { type: 'audio/midi' });
	await assert.rejects(runtime.controller.actions.project.importFiles(badFirst ? [broken, healthy] : [healthy, broken]), /Not a Standard MIDI file/u);
	const recipient = await runtime.reopen();
	assert.equal(recipient.project.clips.length, 1); assert.equal(recipient.project.sources.length, 1);
	const source = recipient.project.sources[0]; assert.ok(source?.kind === 'audio');
	assert.equal(source.name, 'Healthy.wav'); assert.equal(source.sampleRate, 48_000);
	assert.equal(source.frameCount, 4800); assert.equal(source.channelCount, 1);
	const channels = await readCustodyPcm(recipient.store, source);
	assert.equal(channels.length, 1); assert.equal(channels[0]?.length, 4800);
	assert.ok(channels[0]?.every(sample => sample === .25));
});
