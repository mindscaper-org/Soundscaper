/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAafDocument } from '../src/common/editor/aaf-import.ts';
import { parseOtioTimeline } from '../src/common/editor/timeline-interchange-otio-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { exchangeMidiBytes, midiAttachmentAaf, midiReferenceOtio } from './helpers/interchange-midi-file-fixtures.ts';

function ids() { let id = 0; return (prefix: string) => `${prefix}-${++id}`; }

test('AAF imports an embedded standard MIDI auxiliary attachment with tempo, track names and channel controls', async () => {
	const document = parseAafDocument(midiAttachmentAaf());
	assert.equal(document.media[0]?.midi, true);
	const blob = document.media[0]?.blob; assert.ok(blob);
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids(), midiFiles: new Map([[document.media[0]!.id, new Uint8Array(await blob.arrayBuffer())]]) });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.deepEqual(project.tracks.map(track => track.name), ['Melody', 'Bass']);
	assert.ok(project.tracks.every(track => readMidiTrack(track)?.instrument === 'triangle'));
	assert.deepEqual(project.clips.map(clip => [clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame]), [[0, 168000, 0], [0, 168000, 0]]);
	assert.deepEqual(project.clips.flatMap(clip => readMidiClip(clip)?.notes.map(note => [note.pitch, note.channel, note.startFrame, note.durationFrames, note.releaseVelocity]) ?? []),
		[[64, 0, 24000, 48000, 32], [48, 1, 0, 24000, 24]]);
	assert.deepEqual(readMidiClip(project.clips[0])?.interchange?.events.map(event => [event.frame, event.status, ...event.data]), [[0, 176, 7, 100], [0, 192, 12]]);
	assert.equal(plan.report.items.some(item => item.disposition === 'missing'), false);
});

test('OTIO referenced SMFs retain source trims and placement while expanding authored MIDI tracks', () => {
	const document = parseOtioTimeline(midiReferenceOtio());
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids(), midiFiles: new Map([[document.media[0]!.id, exchangeMidiBytes()]]) });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.tracks.length, 2);
	assert.deepEqual(project.sources.map(source => source.frameCount), [168000, 168000]);
	assert.deepEqual(project.clips.map(clip => [clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames]), [[48000, 24000, 48000], [48000, 24000, 48000]]);
	assert.deepEqual(project.clips.map(clip => readMidiClip(clip)?.notes[0]?.pitch), [64, 48]);
});

test('missing OTIO MIDI companions retain offline edits and do not invent notes', () => {
	const document = parseOtioTimeline(midiReferenceOtio('file:///MIDI/Score.MID'));
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids() });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.ok(readMidiTrack(project.tracks[0]));
	assert.equal(readMidiClip(project.clips[0]), null);
	assert.equal(project.clips[0]?.timelineStartFrame, 48000);
	assert.ok(plan.report.items.some(item => item.disposition === 'missing'));
});

test('AAF auxiliary MIDI does not silently apply an unsupported source offset', () => {
	const document = parseAafDocument(midiAttachmentAaf({ offset: 5 }));
	assert.ok(document.issues.some(item => item.code === 'aaf.midi-offset-omitted'));
});

test('AAF repeats of one auxiliary file are imported once and missing attachments do not invent cuts', () => {
	const repeated = parseAafDocument(midiAttachmentAaf({ duplicate: true }));
	assert.equal(repeated.tracks.length, 1);
	assert.ok(repeated.issues.some(item => item.code === 'aaf.midi-duplicate-omitted'));
	const missing = parseAafDocument(midiAttachmentAaf({ embedded: false }));
	const plan = buildTimelineInterchangeProject(missing, { createStableId: ids() });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.tracks.length, 1);
	assert.equal(project.clips.length, 0);
	assert.ok(readMidiTrack(project.tracks[0]));
	assert.ok(plan.report.items.some(item => item.code === 'aaf.midi-attachment-missing'));
});

test('OTIO file-clock MIDI metadata resamples together with notes and SMPTE timing stays independent of tempo', () => {
	const document = parseOtioTimeline(midiReferenceOtio());
	const options = { createStableId: ids(), sampleRate: 24000, midiFiles: new Map([[document.media[0]!.id, exchangeMidiBytes()]]) };
	const project = createCurrentAudioEditorProject(buildTimelineInterchangeProject(document, options).project);
	const data = readMidiClip(project.clips[0])!;
	assert.equal(data.notes[0]?.startFrame, 12000);
	assert.equal(data.notes[0]?.durationFrames, 24000);
	assert.deepEqual(data.interchange?.tempos, [{ frame: 0, bpm: 120 }, { frame: 12000, bpm: 60 }]);
	const bytes = exchangeMidiBytes(); bytes[12] = 0xe7; bytes[13] = 40;
	const smpte = createCurrentAudioEditorProject(buildTimelineInterchangeProject(document, { createStableId: ids(), midiFiles: new Map([[document.media[0]!.id, bytes]]) }).project);
	assert.equal(readMidiClip(smpte.clips[0])?.notes[0]?.startFrame, 23040);
	assert.equal(readMidiClip(smpte.clips[0])?.notes[0]?.durationFrames, 23040);
});
