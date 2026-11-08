/* SPDX-License-Identifier: AGPL-3.0-only */

import { readMidiClip, readMidiTrack, withMidiClipData, withMidiTrackData } from '../midi-model.ts';
import {
	assertClipSourceBounds,
	normalizeClipForProject,
	replaceClip,
} from './shared-runtime.js';
import { defineMidiCommandHandlers, type MidiCommandHandlers } from './midi-commands.ts';
import type { AudioEditorCommand, EditorCommandProject } from './protocol.ts';
import { positiveSafeInteger } from './scalar-guards.ts';

type DataRecord = Record<string, unknown>;

export function createMidiRuntimeHandlers(): Readonly<MidiCommandHandlers> {
	return defineMidiCommandHandlers({
		'midi/clip-set': setMidiClip,
		'midi/track-set': setMidiTrack,
	});
}

function setMidiTrack(projectValue: EditorCommandProject, command: Extract<AudioEditorCommand, { type: 'midi/track-set' }>): void {
	const project = mutableProject(projectValue);
	const track = project.tracks.find(candidate => candidate.id === command.trackId);
	if (!track || !readMidiTrack(track)) throw new ReferenceError(`MIDI track ${command.trackId} is missing.`);
	assertUnlocked(track);
	Object.assign(track, withMidiTrackData(track, command.data));
}

function setMidiClip(projectValue: EditorCommandProject, command: Extract<AudioEditorCommand, { type: 'midi/clip-set' }>): void {
	const project = mutableProject(projectValue);
	const clip = project.clips.find(candidate => candidate.id === command.clipId);
	if (!clip || !readMidiClip(clip)) throw new ReferenceError(`MIDI clip ${command.clipId} is missing.`);
	const track = project.tracks.find(candidate => Array.isArray(candidate.clipIds) && candidate.clipIds.includes(command.clipId));
	if (!track || !readMidiTrack(track)) throw new ReferenceError('A MIDI clip requires a MIDI track owner.');
	assertUnlocked(track);
	const source = project.sources.find(candidate => candidate.id === command.sourceId);
	if (!source || source.kind !== 'audio') throw new ReferenceError('A MIDI clip requires a stored audio fallback source.');
	const tagged = withMidiClipData(clip, command.data);
	const notes = readMidiClip(tagged)!.notes;
	if (notes.some(note => note.startFrame + note.durationFrames > Number(source.frameCount))) {
		throw new RangeError('MIDI notes exceed the fallback source range.');
	}
	const updated = normalizeClipForProject(project, {
		...tagged,
		sourceId: command.sourceId,
		sourceDurationFrames: positiveSafeInteger(command.sourceDurationFrames, 'MIDI source duration'),
		...(command.durationFrames === undefined ? {} : { durationFrames: positiveSafeInteger(command.durationFrames, 'MIDI clip duration') }),
		...(command.warpMap === undefined ? {} : { warpMap: command.warpMap }),
		...(command.musicalDurationBeats === undefined ? {} : { musicalDurationBeats: command.musicalDurationBeats }),
		renderCacheRevision: positiveSafeInteger(Number(clip.renderCacheRevision ?? 0) + 1, 'MIDI render cache revision'),
	});
	assertClipSourceBounds(project, updated);
	replaceClip(project, updated);
}

function assertUnlocked(track: DataRecord): void {
	if (track.locked === true) throw new RangeError(`Track ${String(track.id)} is locked.`);
}

function mutableProject(value: EditorCommandProject): Readonly<{
	clips: DataRecord[];
	tracks: DataRecord[];
	sources: DataRecord[];
}> & DataRecord {
	const project = value as DataRecord;
	if (!Array.isArray(project.clips) || !Array.isArray(project.tracks) || !Array.isArray(project.sources)) {
		throw new TypeError('MIDI commands require a project with clips, tracks and sources.');
	}
	return project as Readonly<{ clips: DataRecord[]; tracks: DataRecord[]; sources: DataRecord[] }> & DataRecord;
}
