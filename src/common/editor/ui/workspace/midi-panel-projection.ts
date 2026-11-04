/* SPDX-License-Identifier: AGPL-3.0-only */

import { readMidiClip, readMidiTrack, type MidiNote } from '../../midi-model.ts';
import type { EditorAudioClip, EditorAudioTrack, EditorProject } from '../../types.ts';
import type { MidiClip, MidiNote as DesignSystemMidiNote } from '@audacity-ui/core';

/** MIDI tempo measures quarter notes; the signature denominator sets bar length. */
export function midiBeatsPerMeasure(signature?: Readonly<{ numerator?: number; denominator?: number }>): number {
	return (signature?.numerator ?? 4) * 4 / (signature?.denominator ?? 4);
}

export function midiPanelSelection(project: EditorProject | null, trackId: string | null, clipId: string | null) {
	if (!project) return null;
	const selectedClip = project.clips.find((clip) => clip.id === clipId && readMidiClip(clip));
	const track = project.tracks.find((entry) => readMidiTrack(entry) && (selectedClip
		? entry.type === 'audio' && entry.clipIds.includes(selectedClip.id)
		: entry.id === trackId)) ?? (!trackId && !clipId ? project.tracks.find((entry) => readMidiTrack(entry)) : null);
	if (track?.type !== 'audio') return null;
	const clip = selectedClip ?? project.clips.find((entry) => track.clipIds.includes(entry.id) && readMidiClip(entry));
	if (clip?.kind !== 'audio') return null;
	return { track: track as EditorAudioTrack, clip: clip as EditorAudioClip };
}

export function designSystemMidiClip(
	clip: EditorAudioClip,
	sampleRate: number,
	selectedIds: ReadonlySet<string>,
	notes: readonly MidiNote[] = readMidiClip(clip)?.notes ?? [],
): MidiClip {
	return {
		id: 1, name: clip.title, start: clip.timelineStartFrame / sampleRate,
		duration: clip.durationFrames / sampleRate, trimStart: clip.sourceStartFrame / sampleRate,
		notes: notes.map((note, index) => ({
			id: index + 1, pitch: note.pitch, velocity: note.velocity,
			startTime: note.startFrame / sampleRate, duration: note.durationFrames / sampleRate,
			selected: selectedIds.has(note.id),
		})),
	};
}

export function midiNoteChanges(updates: Partial<DesignSystemMidiNote>, sampleRate: number): Partial<MidiNote> {
	return {
		...(updates.pitch === undefined ? {} : { pitch: updates.pitch }),
		...(updates.velocity === undefined ? {} : { velocity: updates.velocity }),
		...(updates.startTime === undefined ? {} : { startFrame: Math.max(0, Math.round(updates.startTime * sampleRate)) }),
		...(updates.duration === undefined ? {} : { durationFrames: Math.max(1, Math.round(updates.duration * sampleRate)) }),
	};
}
