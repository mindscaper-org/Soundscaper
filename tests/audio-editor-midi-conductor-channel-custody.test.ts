/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { isDeliveryReport } from '../src/common/editor/delivery-report.ts';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { midiImportArchiveCustody } from './helpers/midi-import-archive-custody.ts';
import { firstMidiClip, midiProject } from './helpers/midi-chronology-custody-fixtures.ts';
import { exactWave, fastConductorMidi, modeReleaseMidi, conductorLoopMidi } from './helpers/midi-fourth-custody-fixtures.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';

for (const existing of [false, true]) test(`fast1200BPM MIDI existingAudio=${existing} retains independent conductor/note/PCM clocks through real controller and archive`, async context => {
	const fixture = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => 'audible' });
	if (existing) await fixture.controller.actions.project.importFiles([exactWave('Existing.wav', [new Float32Array(4800).fill(.25)])]);
	await fixture.controller.actions.project.importFiles([new File([fastConductorMidi()], 'Fast.mid')]);
	const recipient = await fixture.reopen();
	assert.equal(recipient.project.clips.length, existing ? 2 : 1);
	assert.equal(recipient.project.tempo.bpm, 120);
	assert.deepEqual(recipient.project.tempo.timeSignature, { numerator: existing ? 4 : 3, denominator: 4 });
	const clip = recipient.project.clips.find(clip => clip.title === 'Fast'); assert.ok(clip);
	const data = readMidiClip(clip); assert.ok(data);
	assert.deepEqual(data.notes.map(note => [note.startFrame, note.durationFrames, note.pitch, note.velocity]), [[0, 24_000, 60, 100]]);
	assert.deepEqual(data.interchange?.tempos, [{ frame: 0, bpm: 1200 }]);
	assert.equal(clip.durationFrames, 24_000);
	const source = recipient.project.sources.find(source => source.id === clip.sourceId); assert.ok(source?.kind === 'audio');
	assert.equal(source.frameCount, 24_000);
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	assert.ok(samples.slice(9600, 19_200).some(sample => Math.abs(sample) > .05));
	if (existing) {
		const ordinary = recipient.project.sources.find(source => source.name === 'Existing.wav'); assert.ok(ordinary?.kind === 'audio');
		assert.ok((await readCustodyPcm(recipient.store, ordinary))[0]?.every(sample => sample === .25));
	}
});

for (const [mode, latePedal] of [['omni', false], ['instant', false], ['instant', true]] as const) test(`actual channel release ${mode}/latePedal=${latePedal} retains a two-second note edit and exact bounded synthesized voice`, async context => {
	const fixture = await midiImportArchiveCustody(context, { sourcePcmExpectation: () => mode === 'instant' ? 'silent' : 'audible' });
	await fixture.controller.actions.project.importFiles([new File([modeReleaseMidi(mode, latePedal)], 'Release.mid')]);
	const clip = firstMidiClip(fixture.controller.project);
	const original = readMidiClip(clip)?.notes[0]; assert.ok(original);
	assert.equal(original.durationFrames, mode === 'omni' ? 24_000 : 1);
	await fixture.controller.actions.midi.updateNote(clip.id, original.id, { durationFrames: 96_000 });
	const recipient = await fixture.reopen();
	const edited = firstMidiClip(recipient.project);
	assert.equal(readMidiClip(edited)?.notes[0]?.durationFrames, 96_000);
	const source = recipient.project.sources.find(source => source.id === edited.sourceId); assert.ok(source?.kind === 'audio');
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	if (mode === 'omni') {
		assert.ok(samples.slice(4800, 9600).some(sample => Math.abs(sample) > .02));
		assert.ok(samples.slice(24_000).every(sample => sample === 0));
	} else assert.ok(samples.every(sample => sample === 0));
	assert.ok(samples.slice(30_000, 40_000).every(sample => sample === 0));
});

for (const [changes, duration] of [[false, 192_000], [true, 192_000], [true, 204_000]] as const) test(`actual loop conductor changes=${changes}/duration=${duration} restarts literal source clocks after archive and MIDI delivery`, async context => {
	const fixture = await midiImportArchiveCustody(context);
	await fixture.controller.actions.project.importFiles([new File([conductorLoopMidi(changes)], 'Meter loop.mid')]);
	const clip = firstMidiClip(fixture.controller.project);
	await fixture.controller.actions.clip.update(clip.id, { loop: { periodFrames: 96_000, durationFrames: duration, offsetFrames: 0 } });
	const recipient = await fixture.reopen();
	const looped = firstMidiClip(recipient.project);
	assert.deepEqual(readClipLoop(looped), { periodFrames: 96_000, offsetFrames: 0 });
	assert.equal(looped.durationFrames, duration);
	await recipient.controller.actions.midi.exportFile('midi');
	const bytes = fixture.saved.at(-1)?.bytes; assert.ok(bytes instanceof Uint8Array);
	const delivered = parseMidiFile(bytes, { sampleRate: 48_000 });
	const at = duration === 204_000 ? 198_000 : 108_000;
	assert.equal(delivered.tempos.filter(event => event.frame <= at).at(-1)?.bpm, 120);
	assert.equal(delivered.signatures.filter(event => event.frame <= at).at(-1)?.numerator, 4);
	assert.deepEqual(delivered.tracks.flatMap(track => track.notes).map(note => [note.startFrame, note.durationFrames, note.pitch]),
		duration === 204_000 ? [[0, 12_000, 60], [72_000, 12_000, 64], [96_000, 12_000, 60], [168_000, 12_000, 64], [192_000, 12_000, 60]]
			: [[0, 12_000, 60], [72_000, 12_000, 64], [96_000, 12_000, 60], [168_000, 12_000, 64]]);
	assert.deepEqual(delivered.signatures.map(event => [event.frame, event.numerator, event.denominator]), !changes ? [[0, 4, 4]]
		: duration === 204_000 ? [[0, 4, 4], [24_000, 3, 4], [96_000, 4, 4], [120_000, 3, 4], [192_000, 4, 4]]
			: [[0, 4, 4], [24_000, 3, 4], [96_000, 4, 4], [120_000, 3, 4]]);
	if (changes) {
		assert.deepEqual(delivered.tempos.map(event => [event.frame, event.bpm]), duration === 204_000
			? [[0, 120], [24_000, 60], [96_000, 120], [120_000, 60], [192_000, 120]]
			: [[0, 120], [24_000, 60], [96_000, 120], [120_000, 60]]);
	} else assert.deepEqual(delivered.tempos, [{ frame: 0, bpm: 120 }]);
});

for (const ratio of [1, 2]) test(`actual linked MIDI speed${ratio} preserves editable source pitch/PCM, exact delivery duration and saved omission report`, async context => {
	const fixture = await midiImportArchiveCustody(context);
	const bytes = writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name: 'Pitch programme', durationFrames: 96_000,
		notes: [{ id: 'n', pitch: 69, velocity: 100, channel: 0, startFrame: 0, durationFrames: 96_000 }] }] });
	await fixture.controller.actions.project.importFiles([new File([bytes], 'Pitch programme.mid')]);
	const clip = firstMidiClip(fixture.controller.project);
	await fixture.controller.actions.clip.setTimePitch(clip.id, { linkPitchAndTempo: true });
	await fixture.controller.actions.clip.setTimePitch(clip.id, { speedRatio: ratio });
	const recipient = await fixture.reopen();
	const finished = firstMidiClip(recipient.project);
	assert.equal(finished.linkPitchAndTempo, true); assert.equal(finished.speedRatio, ratio);
	assert.equal(finished.durationFrames, 96_000 / ratio);
	assert.deepEqual(readMidiClip(finished)?.notes.map(note => [note.pitch, note.durationFrames]), [[69, 96_000]]);
	const source = recipient.project.sources.find(source => source.id === finished.sourceId); assert.ok(source?.kind === 'audio');
	const samples = (await readCustodyPcm(recipient.store, source))[0]; assert.ok(samples);
	let crossings = 0; for (let frame = 12_001; frame < 36_000; frame++) if (samples[frame - 1]! < 0 && samples[frame]! >= 0) crossings++;
	assert.ok(crossings * 2 > 432 && crossings * 2 < 448, 'the stored editable source remains the independently authored440Hz note');
	const before = structuredClone(midiProject(recipient.controller.project));
	await recipient.controller.actions.midi.exportFile('midi');
	const output = fixture.saved.at(-1)?.bytes; assert.ok(output instanceof Uint8Array);
	assert.deepEqual(parseMidiFile(output, { sampleRate: 48_000 }).tracks.flatMap(track => track.notes).map(note => [note.pitch, note.durationFrames]), [[69, 96_000 / ratio]]);
	const report: unknown = recipient.controller.getSnapshot().deliveryReport; assert.ok(isDeliveryReport(report));
	assert.equal(report.counts.omitted, ratio === 1 ? 0 : 1);
	const omission = report.items.find(item => item.code === 'MIDI_CLIP_PITCH_OMITTED');
	if (ratio === 2) { assert.equal(omission?.severity, 'warning'); assert.equal(omission.data.pitchCents, 1200); assert.equal(omission.scope.clipId, clip.id); }
	else assert.equal(omission, undefined);
	await recipient.controller.actions.export.saveReport();
	const blob = fixture.saved.at(-1)?.blob; assert.ok(blob instanceof Blob);
	const text = await blob.text();
	const saved: unknown = JSON.parse(text); assert.ok(saved && typeof saved === 'object');
	assert.equal(Reflect.get(saved, 'documentVersion'), 1); assert.equal(Reflect.get(saved, 'kind'), 'delivery-report');
	assert.deepEqual(Reflect.get(saved, 'subject'), report.subject); assert.deepEqual(Reflect.get(saved, 'counts'), report.counts);
	assert.deepEqual(Reflect.get(saved, 'items'), report.items);
	assert.deepEqual(recipient.controller.project, before);
});
