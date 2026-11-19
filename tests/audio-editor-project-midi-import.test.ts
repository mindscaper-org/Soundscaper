/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineInterchange } from '../src/common/editor/timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { soundcraftMidiSession, ardourMidiSession, ardourMidiBytes } from './helpers/project-midi-import-fixtures.ts';

function ids() { let id = 0; return (prefix: string) => `${prefix}-${++id}`; }

test('SoundCraft imports editable MIDI beside audio using the session tempo at the clip origin', () => {
	const document = parseTimelineInterchange('mixed.scraft', JSON.stringify(soundcraftMidiSession()));
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids() });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.tracks.length, 2);
	assert.equal(project.clips.length, 2);
	assert.equal(readMidiTrack(project.tracks[1])?.instrument, 'triangle');
	const clip = project.clips[1]!;
	assert.equal(clip.timelineStartFrame, 24000);
	assert.equal(clip.durationFrames, 96000);
	const data = readMidiClip(clip)!;
	assert.ok(data);
	assert.deepEqual(data.notes.map(({ pitch, channel, velocity, releaseVelocity, startFrame, durationFrames }) =>
		({ pitch, channel, velocity, releaseVelocity, startFrame, durationFrames })),
	[{ pitch: 64, channel: 2, velocity: 100, releaseVelocity: 32, startFrame: 24000, durationFrames: 96000 }]);
	assert.deepEqual(data.interchange?.events, [{ frame: 0, status: 0xc2, data: [12] }, { frame: 24000, status: 0xb2, data: [64, 127] }]);
	assert.ok(plan.report.items.some(item => item.code === 'soundcraft.midi-instrument-converted'));
});

test('Ardour active MIDI playlists retain beat-domain trims and report a missing companion', () => {
	const document = parseTimelineInterchange('notes.ardour', ardourMidiSession());
	assert.equal(document.media[0]?.path, 'interchange/Notes/midifiles/keys.mid');
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids() });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.clips[0]?.timelineStartFrame, 48000);
	assert.equal(project.clips[0]?.sourceStartFrame, 24000);
	assert.equal(project.clips[0]?.durationFrames, 48000);
	assert.equal(readMidiTrack(project.tracks[0])?.instrument, 'triangle');
	assert.ok(plan.report.items.some(item => item.code === 'ardour.media-missing'));
});

test('Ardour tempo ramps omit MIDI with a report while retaining the rest of the session', () => {
	const document = parseTimelineInterchange('notes.ardour', ardourMidiSession('<Tempo npm="120" enpm="60" note-type="4" quarters="0:0" sclock="0"/>'));
	assert.equal(document.tracks.length, 1);
	assert.equal(document.tracks[0]?.clips.length, 0);
	assert.ok(document.issues.some(item => item.code === 'ardour.midi-timing-omitted'));
});

test('Ardour MIDI companions use the session tempo across a trimmed region, ignoring SMF default tempo', () => {
	const document = parseTimelineInterchange('notes.ardour', ardourMidiSession(
		'<Tempo npm="120" enpm="120" note-type="4" quarters="0:0" sclock="0"/>'
		+ '<Tempo npm="60" enpm="60" note-type="4" quarters="2:0" sclock="282240000"/>'));
	const plan = buildTimelineInterchangeProject(document, { createStableId: ids(), midiFiles: new Map([[document.media[0]!.id, ardourMidiBytes()]]) });
	const project = createCurrentAudioEditorProject(plan.project);
	const clip = project.clips[0]!;
	assert.equal(clip.timelineStartFrame, 48000);
	assert.equal(clip.sourceStartFrame, 24000);
	assert.equal(clip.durationFrames, 96000);
	const data = readMidiClip(clip)!;
	assert.ok(data);
	assert.deepEqual(data.notes.map(note => [note.startFrame, note.durationFrames, note.pitch, note.channel, note.velocity, note.releaseVelocity]),
		[[24000, 48000, 64, 2, 100, 32]]);
	assert.deepEqual(data.interchange?.events.map(event => [event.frame, event.status, ...event.data]),
		[[0, 0xc2, 12], [0, 0xb2, 64, 127], [120000, 0xb2, 64, 0]]);
	assert.equal(plan.midiSources.length, 1);
	assert.equal(plan.report.items.some(item => item.disposition === 'missing'), false);
});

test('SoundCraft malformed MIDI values fail admission before source staging', () => {
	const session = soundcraftMidiSession();
	const note = session.tracks[1]!.playlists[0]!.clips[0]!.content.Midi.sequence.notes[0]!;
	for (const pitch of [-1, 128, 1.5]) {
		const text = JSON.stringify(session).replace(`"pitch":${note.pitch}`, `"pitch":${pitch}`);
		assert.throws(() => parseTimelineInterchange('notes.scraft', text), /pitch/iu);
	}
});
