/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';
import { exactWave, ordinaryMidi } from './helpers/midi-fourth-custody-fixtures.ts';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { midiProject } from './helpers/midi-chronology-custody-fixtures.ts';
import { deferred } from './helpers/async-test-control.ts';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';

for (const position of ['none', 'first', 'middle'] as const) test(`actual legacy/AU/WAV companion batch MIDI${position} retains literal ownership and decoded PCM through independent Scape`, async context => {
	const fixture = await midiImportArchiveCustody(context, { legacyAuImport: true, sourcePcmExpectation: () => 'audible' });
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const independent = exactWave('Independent.au', [new Float32Array(4800).fill(.125)]);
	const midi = ordinaryMidi('Extra MIDI');
	const files = position === 'none' ? [projectFile, dataFile, independent]
		: position === 'first' ? [midi, projectFile, dataFile, independent] : [projectFile, midi, dataFile, independent];
	await fixture.controller.actions.project.importFiles(files);
	const recipient = await fixture.reopen();
	assert.equal(recipient.project.clips.length, position === 'none' ? 2 : 3);
	assert.equal(recipient.project.sources.length, position === 'none' ? 2 : 3);
	const track = recipient.project.tracks.find(track => track.name === 'Voix 日本語 🎙'); assert.ok(track?.type === 'audio');
	const legacy = recipient.project.clips.find(clip => track.clipIds.includes(clip.id)); assert.ok(legacy);
	const source = recipient.project.sources.find(source => source.id === legacy.sourceId); assert.ok(source?.kind === 'audio');
	assert.equal(source.frameCount, 4800); assert.equal(source.channelCount, 1); assert.equal(source.sampleRate, 48_000);
	assert.deepEqual((await readCustodyPcm(recipient.store, source))[0], Float32Array.from({ length: 4800 }, (_, frame) => frame % 2 ? -.25 : .25));
	const additional = recipient.project.sources.find(source => source.name === 'Independent.au'); assert.ok(additional?.kind === 'audio');
	assert.ok((await readCustodyPcm(recipient.store, additional))[0]?.every(sample => sample === .125));
	assert.equal(additional.frameCount, 4800); assert.equal(additional.channelCount, 1);
	assert.equal(recipient.project.timelineAnnotations[0]?.name, 'Repère 日本語 🎵');
	const notes = recipient.project.clips.flatMap(clip => readMidiClip(clip)?.notes ?? []);
	assert.deepEqual(notes.map(note => [note.startFrame, note.durationFrames, note.channel, note.pitch, note.velocity]),
		position === 'none' ? [] : [[0, 4800, 0, 60, 90]]);
});

for (const arrangement of ['ordinary', 'trailing', 'interleaved'] as const) test(`actual targeted mixed import${arrangement} preserves literal WAV planes, independent lane ordering and MIDI placement through archive`, async context => {
	const fixture = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => 'audible' });
	const wave = (name: string, value: number) => exactWave(name, [new Float32Array(48_000).fill(value), new Float32Array(48_000).fill(-value)]);
	await fixture.controller.actions.project.importFiles([wave('Bed.wav', .125)]);
	const initial = midiProject(fixture.controller.project);
	const bedClip = initial.clips[0]; assert.ok(bedClip);
	const bed = initial.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(bedClip.id)); assert.ok(bed);
	const first = wave('First.wav', .25), second = wave('Second.wav', .5), midi = ordinaryMidi();
	await fixture.controller.actions.project.importFiles(arrangement === 'ordinary' ? [first, second]
		: arrangement === 'trailing' ? [first, second, midi] : [first, midi, second], { destination: 'timeline', trackId: bed.id, timelineStartFrame: 48_000 });
	const recipient = await fixture.reopen();
	assert.equal(recipient.project.clips.length, arrangement === 'ordinary' ? 3 : 4);
	const sourceNames = new Map(recipient.project.sources.map(source => [source.id, source.name]));
	const clipNamed = (name: string) => { const clip = recipient.project.clips.find(clip => sourceNames.get(clip.sourceId) === name); assert.ok(clip); return clip; };
	const firstClip = clipNamed('First.wav'), secondClip = clipNamed('Second.wav');
	const owner = (id: string) => { const track = recipient.project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(id)); assert.ok(track); return track; };
	assert.equal(owner(firstClip.id).id, bed.id); assert.notEqual(owner(secondClip.id).id, bed.id);
	assert.equal(recipient.project.tracks.indexOf(owner(secondClip.id)), recipient.project.tracks.findIndex(track => track.id === bed.id) + 1);
	assert.equal(firstClip.timelineStartFrame, 48_000); assert.equal(secondClip.timelineStartFrame, 48_000);
	for (const [name, value] of [['Bed.wav', .125], ['First.wav', .25], ['Second.wav', .5]] as const) {
		const source = recipient.project.sources.find(source => source.name === name); assert.ok(source?.kind === 'audio');
		assert.equal(source.channelCount, 2); assert.equal(source.frameCount, 48_000);
		const samples = await readCustodyPcm(recipient.store, source);
		assert.ok(samples[0]?.every(sample => sample === value)); assert.ok(samples[1]?.every(sample => sample === -value));
	}
	const notes = recipient.project.clips.filter(clip => readMidiClip(clip));
	assert.equal(notes.length, arrangement === 'ordinary' ? 0 : 1);
	if (arrangement !== 'ordinary') {
		assert.equal(notes[0]?.timelineStartFrame, 48_000);
		assert.deepEqual(readMidiClip(notes[0])?.notes.map(note => [note.startFrame, note.durationFrames, note.pitch]), [[0, 4800, 60]]);
	}
});

for (const cancel of [false, true]) test(`actual held File/Blob mixed batch cancel=${cancel} preserves its terminal decision, later-read admission and portable project`, async context => {
	const entered = deferred<void>(), release = deferred<void>();
	context.after(() => { release.resolve(); });
	const fixture = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => 'audible' });
	const wav = exactWave('Cancel take.wav', [new Float32Array(4800).fill(.25)]);
	class HeldWave extends File {
		override slice(start?: number, end?: number, type?: string): Blob {
			const blob = super.slice(start, end, type), read = blob.arrayBuffer.bind(blob);
			blob.arrayBuffer = async () => { entered.resolve(); await release.promise; return read(); };
			return blob;
		}
	}
	class CountedMidi extends File {
		reads = 0;
		override arrayBuffer(): Promise<ArrayBuffer> { this.reads++; return super.arrayBuffer(); }
	}
	const midi = ordinaryMidi('Later');
	const later = new CountedMidi([await midi.arrayBuffer()], 'Later.mid', { type: 'audio/midi' });
	const pending = importWorkspaceRoutedFiles({ controller: fixture.controller,
		files: [new HeldWave([await wav.arrayBuffer()], wav.name, { type: wav.type }), later,
			new File(['0\t1\tLater label\n'], 'Later.txt', { type: 'text/plain' })],
		importOptions: { destination: 'timeline' }, projectBinVisible: false,
		openProjectFile: () => assert.fail('The mixed batch contains no project file'),
		requestCueImport: () => assert.fail('The mixed batch contains no cue file') });
	const outcome = Promise.allSettled([pending]);
	try {
		await Promise.race([entered.promise, outcome.then(() => assert.fail('The real bounded Blob read must reach the controlled gate'))]);
		if (cancel) assert.equal(fixture.controller.actions.project.cancelTask(), true);
	} finally { release.resolve(); }
	const result = (await outcome)[0]; assert.equal(result?.status, 'fulfilled');
	assert.equal(later.reads, cancel ? 0 : 1);
	if (result?.status === 'fulfilled') assert.equal(result.value, cancel ? 0 : 3);
	const recipient = await fixture.reopen();
	assert.equal(recipient.project.clips.length, cancel ? 0 : 2);
	const labels = recipient.project.tracks.filter(track => track.type === 'label'); assert.equal(labels.length, cancel ? 0 : 1);
	if (cancel) assert.equal(recipient.project.sources.length, 0);
	else {
		const source = recipient.project.sources.find(source => source.name === 'Cancel take.wav'); assert.ok(source?.kind === 'audio');
		assert.ok((await readCustodyPcm(recipient.store, source))[0]?.every(sample => sample === .25));
		const track = labels[0]; assert.ok(track && Array.isArray(track.labels));
		const label: unknown = track.labels[0]; assert.ok(label && typeof label === 'object');
		assert.deepEqual([Reflect.get(label, 'title'), Reflect.get(label, 'startFrame'), Reflect.get(label, 'endFrame')], ['Later label', 0, 48_000]);
	}
});
