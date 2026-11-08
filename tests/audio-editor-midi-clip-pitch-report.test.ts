/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import type { MidiFileDocument } from '../src/common/editor/midi-file-types.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { midiFileDeliveryReport } from '../src/common/editor/midi-file-delivery-report.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

async function fixture() {
	const base = midiServiceFixture();
	const { trackId, clipId } = await base.service.addTrack();
	await base.service.addNote(clipId, { id: 'note', pitch: 69, velocity: 100, channel: 0, startFrame: 0, durationFrames: 4000 });
	const reports: DeliveryReport[] = [];
	const service = createMidiService({ ...base.dependencies, publishDeliveryReport: report => { reports.push(report); } });
	return { ...base, service, reports, trackId, clipId };
}

for (const format of ['midi', 'allegro'] as const) test(`${format} reports independent clip pitch finishing without changing editable notes`, async () => {
	const f = await fixture();
	f.apply({ type: 'clip/update', clipId: f.clipId, changes: { pitchCents: 1200 } });
	await f.service.exportFile(format);
	const report = f.reports.at(-1);
	assert.ok(report);
	const omitted = report.items.find(item => item.code === 'MIDI_CLIP_PITCH_OMITTED');
	assert.ok(omitted, 'The completed file must disclose the omitted pitch finishing.');
	assert.equal(omitted.disposition, 'omitted');
	assert.equal(omitted.severity, 'warning');
	assert.equal(omitted.scope.clipId, f.clipId);
	assert.equal(omitted.scope.trackId, f.trackId);
	assert.equal(omitted.data.pitchCents, 1200);
	assert.equal(report.counts.omitted, 1);
	const saved = f.saves.at(-1);
	assert.ok(saved);
	let document: MidiFileDocument;
	if (format === 'midi') {
		assert.ok(saved.bytes instanceof Uint8Array);
		document = parseMidiFile(saved.bytes, { sampleRate: 8000 });
	} else {
		assert.equal(typeof saved.text, 'string');
		document = parseAllegroFile(String(saved.text), { sampleRate: 8000 });
	}
	assert.equal(document.tracks.flatMap(track => track.notes)[0]?.pitch, 69);
});

test('linked clip speed reports its actual native-rate pitch rather than a dormant independent pitch', async () => {
	const f = await fixture();
	const clip = f.project().clips.find(clip => clip.id === f.clipId);
	assert.ok(clip && typeof clip.durationFrames === 'number');
	f.apply({ type: 'clip/trim', clipId: f.clipId, timelineStartFrame: 0, sourceStartFrame: 0,
		durationFrames: clip.durationFrames / 2, sourceDurationFrames: clip.sourceDurationFrames });
	f.apply({ type: 'clip/update', clipId: f.clipId, changes: { speedRatio: 2, linkPitchAndTempo: true, pitchCents: -500 } });
	await f.service.exportFile('midi');
	const omitted = f.reports.at(-1)?.items.find(item => item.code === 'MIDI_CLIP_PITCH_OMITTED');
	assert.ok(omitted);
	assert.equal(omitted.data.pitchCents, 1200);
	assert.equal(omitted.data.title, clip.title);
});

for (const linked of [false, true]) test(`${linked ? 'dormant independent pitch at neutral linked speed' : 'neutral independent pitch'} remains a clean MIDI delivery`, async () => {
	const f = await fixture();
	f.apply({ type: 'clip/update', clipId: f.clipId, changes: { linkPitchAndTempo: linked, pitchCents: linked ? 1200 : 0 } });
	await f.service.exportFile('midi');
	assert.equal(f.reports.at(-1)?.counts.omitted, 0);
});

test('independent speed changes encode note timing without inventing a pitch omission', async () => {
	const f = await fixture();
	const clip = f.project().clips.find(clip => clip.id === f.clipId);
	assert.ok(clip && typeof clip.durationFrames === 'number');
	f.apply({ type: 'clip/trim', clipId: f.clipId, timelineStartFrame: 0, sourceStartFrame: 0,
		durationFrames: clip.durationFrames / 2, sourceDurationFrames: clip.sourceDurationFrames });
	f.apply({ type: 'clip/update', clipId: f.clipId, changes: { speedRatio: 2 } });
	await f.service.exportFile('midi');
	assert.equal(f.reports.at(-1)?.counts.omitted, 0);
});

test('linked repeats use their source period rather than the repeated clip extent for pitch disclosure', async () => {
	const f = await fixture();
	const clip = f.project().clips.find(clip => clip.id === f.clipId);
	assert.ok(clip && typeof clip.durationFrames === 'number');
	f.apply({ type: 'clip/update', clipId: f.clipId, changes: { speedRatio: 2, linkPitchAndTempo: true,
		loop: { periodFrames: clip.durationFrames / 2, durationFrames: clip.durationFrames * 1.5, offsetFrames: 0 } } });
	await f.service.exportFile('midi');
	assert.equal(f.reports.at(-1)?.items.find(item => item.code === 'MIDI_CLIP_PITCH_OMITTED')?.data.pitchCents, 1200);
	assert.equal(f.reports.at(-1)?.counts.omitted, 1);
});

test('a different native source rate at neutral linked playback produces no false pitch omission', () => {
	const source = createAudioSource({ id: 'source', sampleRate: 16000, frameCount: 16000, channelCount: 1 });
	const clip = createMidiClip({ id: 'clip', title: 'Native source clock', sourceId: source.id,
		durationFrames: 8000, sourceDurationFrames: 16000, linkPitchAndTempo: true,
		notes: [{ id: 'note', pitch: 69, velocity: 100, channel: 0, startFrame: 0, durationFrames: 16000 }] });
	const track = createMidiTrack({ id: 'track', clipIds: [clip.id] }, 8000);
	const project = createAudioEditorProjectV17({ sampleRate: 8000, sources: [source], clips: [{ ...clip }], tracks: [{ ...track }] });
	assert.equal(midiFileDeliveryReport(midiDocumentFromProject(project), 'midi', project).counts.omitted, 0);
});
