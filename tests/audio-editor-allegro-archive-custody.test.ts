/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';

const conductor = '#track 0 Field order\nT0 -tempor:60\nT1 -tempor:120\nT0\n';
const note = 'T1 V0 P60 U0.5 L100\n';
const anchor = 'T2 -beatr:4\n';
const globalLyrics = 'T0 -tempor:120\nT0 V- -lyrics:"hello"\nT0 V2 K60 P60 U0.5 L90\n';
const accepted = [
	{ name: 'key and symbolic duration', text: '#track 0\nT0 -tempor:120\nT0 V0 K64 Q L100\n', expected: [0, 24_000, 64, 0, 100] },
	{ name: 'key and inherited duration', text: '#track 0\nT0 -tempor:120\nT0 V0 K64 L100\n', expected: [0, 48_000, 64, 0, 100] },
	{ name: 'duration before key', text: '#track 0\nT0 -tempor:120\nT0 V0 Q K64 L100\n', expected: [0, 24_000, 64, 0, 100] },
	{ name: 'key and numeric duration', text: '#track 0\nT0 -tempor:120\nT0 V0 K64 U0.1 L100\n', expected: [0, 4800, 64, 0, 100] },
	{ name: 'event next interval', text: '#track 0\nT0 N0.5 V0 -control7r:1.0\nP60 U0.25\n', expected: [24_000, 12_000, 60, 0, 100] },
	{ name: 'non-event next interval', text: '#track 0\nN0.5\nV0 P60 U0.25\n', expected: [0, 12_000, 60, 0, 100] },
	{ name: 'duration before time', text: `${conductor}Q T1 V0 P60 L100\n`, expected: [48_000, 48_000, 60, 0, 100] },
	{ name: 'time before duration', text: `${conductor}T1 Q V0 P60 L100\n`, expected: [48_000, 24_000, 60, 0, 100] },
	{ name: 'conductor-first beat anchor', text: `#track 0 Piano\n${anchor}${note}`, expected: [48_000, 24_000, 60, 0, 100] },
	{ name: 'conductor-first tempo', text: `#track 0 Piano\nT0 -tempor:120\n${note}`, expected: [48_000, 24_000, 60, 0, 100] },
	{ name: 'beat note before later anchor', text: `#track 0 Piano\nTQ1 V0 P60 Q L100\n${anchor}`, expected: [24_000, 24_000, 60, 0, 100] },
	{ name: 'global lyrics', text: globalLyrics, expected: [0, 24_000, 60, 2, 90] },
] as const;

for (const fixture of accepted) test(`Allegro ${fixture.name} survives controller, synthesis, Scape and MIDI delivery`, async context => {
	const runtime = await midiImportArchiveCustody(context);
	await runtime.controller.actions.project.importFiles([new File([fixture.text], 'Notes.gro', { type: 'text/plain' })]);
	const recipient = await runtime.reopen();
	const notes = recipient.project.clips.flatMap(clip => readMidiClip(clip)?.notes ?? []);
	assert.deepEqual(notes.map(value => [value.startFrame, value.durationFrames, value.pitch, value.channel, value.velocity]), [fixture.expected]);
	await recipient.controller.actions.midi.exportFile('midi');
	const output = runtime.saved.at(-1)?.bytes; assert.ok(output instanceof Uint8Array);
	const delivered = parseMidiFile(output, { sampleRate: 48_000 });
	assert.deepEqual(delivered.tracks.flatMap(track => track.notes).map(value =>
		[value.startFrame, value.durationFrames, value.pitch, value.channel, value.velocity]), [fixture.expected]);
	if (fixture.name === 'global lyrics') {
		const events = delivered.tracks.flatMap(track => track.events ?? []);
		assert.deepEqual(events.filter(event => event.metaType === 5).map(event => event.data), [[104, 101, 108, 108, 111]]);
		assert.deepEqual(events.filter(event => event.metaType === 32), []);
	}
});

for (const [name, text, message] of [
	['late beat anchor', `#track 0 Piano\n${note}${anchor}`, /earlier events require clock retiming/iu],
	['late tempo', `#track 0 Piano\n${note}T0 -tempor:120\n`, /earlier events require clock retiming/iu],
	['explicit channel lyrics', 'T0 -tempor:120\nT0 V2 -lyrics:"hello"\nT0 V2 K60 P60 U0.5 L90\n', /Channel-scoped Allegro text/iu],
	['implicit channel lyrics', 'T0 -tempor:120\nT0 -lyrics:"hello"\nT0 V2 K60 P60 U0.5 L90\n', /Channel-scoped Allegro text/iu],
] as const) test(`Allegro ${name} refuses atomically and a later ordinary import still succeeds`, async context => {
	const runtime = await midiImportArchiveCustody(context);
	const before = structuredClone(runtime.controller.project);
	await assert.rejects(runtime.controller.actions.project.importFiles([new File([text], 'Unsupported.gro')]), message);
	assert.deepEqual(runtime.controller.project, before);
	assert.equal(runtime.saved.length, 0);
	await runtime.controller.actions.project.importFiles([new File([globalLyrics], 'Recovered.gro')]);
	const recipient = await runtime.reopen();
	assert.deepEqual(recipient.project.clips.flatMap(clip => readMidiClip(clip)?.notes ?? []).map(value =>
		[value.startFrame, value.durationFrames, value.pitch, value.channel]), [[0, 24_000, 60, 2]]);
});

test('raw MIDI channel-prefix and lyric identities survive controller and portable reopening', async context => {
	const bytes = writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name: 'Scoped lyrics',
		notes: [{ id: 'n', channel: 2, pitch: 60, velocity: 90, startFrame: 0, durationFrames: 24_000 }],
		events: [{ frame: 0, status: 255, metaType: 32, data: [2] }, { frame: 0, status: 255, metaType: 5, data: [104, 101, 108, 108, 111] }] }] });
	const runtime = await midiImportArchiveCustody(context);
	await runtime.controller.actions.project.importFiles([new File([bytes], 'Scoped lyrics.mid')]);
	const recipient = await runtime.reopen();
	await recipient.controller.actions.midi.exportFile('midi');
	const output = runtime.saved.at(-1)?.bytes; assert.ok(output instanceof Uint8Array);
	const events = parseMidiFile(output).tracks.flatMap(track => track.events ?? []);
	assert.deepEqual(events.filter(event => event.metaType === 32).map(event => event.data), [[2]]);
	assert.deepEqual(events.filter(event => event.metaType === 5).map(event => event.data), [[104, 101, 108, 108, 111]]);
});

for (const explicit of [false, true]) test(`absolute Allegro lane inventory survives portable reopening: explicit=${String(explicit)}`, async context => {
	const text = (explicit ? '#track 0\n#track 1\n' : '') + '#track 2 Lead\nT0 V0 P60 U0.125 L100\n';
	const runtime = await midiImportArchiveCustody(context);
	await runtime.controller.actions.project.importFiles([new File([text], 'Three tracks.gro')]);
	const recipient = await runtime.reopen();
	assert.equal(recipient.project.tracks.length, 4);
	assert.deepEqual(recipient.project.tracks.filter(readMidiTrack).map(track => track.name), ['MIDI 1', 'MIDI 2', 'Lead']);
	assert.equal(recipient.project.clips.length, 3); assert.equal(recipient.project.sources.length, 3);
	assert.deepEqual(recipient.project.clips.map(clip => readMidiClip(clip)?.notes.map(value => [value.startFrame, value.durationFrames, value.pitch])),
		[[], [], [[0, 6000, 60]]]);
	await recipient.controller.actions.midi.exportFile('midi');
	const output = runtime.saved.at(-1)?.bytes; assert.ok(output instanceof Uint8Array);
	assert.deepEqual(parseMidiFile(output).tracks.filter(track => !track.conductorOnly).map(track => track.name), ['MIDI 1', 'MIDI 2', 'Lead']);
});
