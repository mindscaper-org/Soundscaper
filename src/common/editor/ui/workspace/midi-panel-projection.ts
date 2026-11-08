/* SPDX-License-Identifier: AGPL-3.0-only */

import { readMidiClip, readMidiTrack, type MidiNote } from '../../midi-model.ts';
import type { EditorAudioClip, EditorAudioTrack, EditorProject } from '../../types.ts';
import type { AudioClipLeaf } from '../../project-media-types.ts';
import { resolveRuntimeClipProjection } from '../../runtime-clip-projection.ts';
import { midiProjectTiming } from '../../midi-project-timing.ts';
import type { MidiClip, MidiNote as DesignSystemMidiNote } from '@audacity-ui/core';
import { readClipLoop } from '../../audio-clip-loop.ts';
import { createAudioWarpRuntimeEvaluator } from '../../audio-warp-runtime.ts';
import type { HoldTempoMap } from '../../timeline-time.ts';
import { clipSourceDisplayRange, clipSourceFrameToDisplay } from '../../clip-source-timing.ts';

/** Selection reads persisted clips; editing consumes only the selected clip's resolved coordinates. */
type MidiPanelAudioClip = EditorAudioClip | (AudioClipLeaf & Readonly<Record<string, unknown>>);
export type MidiPanelProject = Pick<EditorProject, 'id' | 'sampleRate' | 'sources' | 'tracks' | 'tempoMap' | 'signatureMap'> & Readonly<Record<string, unknown>> & {
	readonly clips: readonly (MidiPanelAudioClip | EditorProject['clips'][number])[];
};

export function resolveMidiPanelClip(project: MidiPanelProject, clip: MidiPanelAudioClip): EditorAudioClip {
	const timingProject = { ...project, tempoMap: midiProjectTiming(project).tempoMap };
	return resolveRuntimeClipProjection(timingProject, clip);
}

/** Each pending publication owns one sparse, ordered note projection. */
export type MidiPanelNoteDrafts = ReadonlyMap<symbol, ReadonlyMap<string, Partial<MidiNote>>>;

export function midiPanelNoteDraft(drafts: MidiPanelNoteDrafts, owner: symbol, changes: ReadonlyMap<string, Partial<MidiNote>> | null): MidiPanelNoteDrafts {
	const next = new Map(drafts);
	next.delete(owner);
	if (changes?.size) next.set(owner, changes);
	return next;
}

export function midiPanelDraftNotes(notes: readonly MidiNote[], drafts: MidiPanelNoteDrafts): readonly MidiNote[] {
	if (!drafts.size) return notes;
	const changes = new Map<string, Partial<MidiNote>>();
	for (const operation of drafts.values()) for (const [id, update] of operation) changes.set(id, { ...changes.get(id), ...update });
	if (!changes.size) return notes;
	return notes.map(note => changes.has(note.id) ? { ...note, ...changes.get(note.id) } : note);
}

export function discardMidiPanelDraftNotes(drafts: MidiPanelNoteDrafts, ids: ReadonlySet<string>): MidiPanelNoteDrafts {
	return new Map([...drafts].map(([owner, changes]) => [owner, new Map([...changes].filter(([id]) => !ids.has(id)))]));
}

/** MIDI tempo measures quarter notes; the signature denominator sets bar length. */
export function midiBeatsPerMeasure(signature?: Readonly<{ numerator?: number; denominator?: number }>): number {
	return (signature?.numerator ?? 4) * 4 / (signature?.denominator ?? 4);
}

export function midiPanelSelection(project: MidiPanelProject | null, trackId: string | null, clipId: string | null) {
	if (!project) return null;
	const selectedClip = project.clips.find((clip) => clip.id === clipId && readMidiClip(clip));
	const track = project.tracks.find((entry) => readMidiTrack(entry) && (selectedClip
		? entry.type === 'audio' && entry.clipIds.includes(selectedClip.id)
		: entry.id === trackId)) ?? (!trackId && !clipId ? project.tracks.find((entry) => readMidiTrack(entry)) : null);
	if (track?.type !== 'audio') return null;
	const clip = selectedClip ?? project.clips.find((entry) => track.clipIds.includes(entry.id) && readMidiClip(entry));
	if (clip?.kind !== 'audio') return null;
	return { track: track as EditorAudioTrack, clip };
}

export function designSystemMidiClip(
	clip: EditorAudioClip,
	sampleRate: number,
	selectedIds: ReadonlySet<string>,
	notes: readonly MidiNote[] = readMidiClip(clip)?.notes ?? [],
	sourceRate = sampleRate,
): MidiClip {
	return {
		id: 1, name: clip.title, start: clip.timelineStartFrame / sampleRate,
		duration: readClipLoop(clip) ? clip.durationFrames / sampleRate : clip.sourceDurationFrames / sourceRate, trimStart: clip.sourceStartFrame / sourceRate,
		notes: notes.map((note, index) => ({
			id: index + 1, pitch: note.pitch, velocity: note.velocity,
			startTime: note.startFrame / sourceRate, duration: note.durationFrames / sourceRate,
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

/** The piano roll edits source notes even when the timeline plays a transformed clip. */
export function createMidiPanelPlayheadProjector(project: MidiPanelProject, clip: EditorAudioClip): (position: number) => number | null {
	const loop = readClipLoop(clip);
	const warp = clip.warpMap == null ? null : createAudioWarpRuntimeEvaluator({ sampleRate: project.sampleRate,
		tempoMap: project.tempoMap as unknown as HoldTempoMap }, clip);
	return position => {
		const relative = position - clip.timelineStartFrame;
		if (relative < 0 || relative >= clip.durationFrames) return null;
		if (warp) { const frame = warp.sourceAtTimelineFrame(position); return frame.num / frame.den; }
		const progress = loop ? ((relative + loop.offsetFrames) % loop.periodFrames) / loop.periodFrames : relative / clip.durationFrames;
		return clip.sourceStartFrame + (clip.reversed === true ? 1 - progress : progress) * clip.sourceDurationFrames;
	};
}

/** Local strip edges address source seconds; its mutation port addresses project frames. */
export function midiPanelClipResize(project: MidiPanelProject, clip: EditorAudioClip, sourceRate: number,
	edge: 'left' | 'right', start: number, duration: number, trimStart: number) {
	let sourceStartFrame = Math.max(0, Math.round(trimStart * sourceRate));
	let sourceDurationFrames = Math.max(1, Math.round(duration * sourceRate));
	let durationFrames: number;
	let timelineStartFrame: number;
	if (readClipLoop(clip)) {
		timelineStartFrame = Math.max(0, Math.round(start * project.sampleRate));
		durationFrames = Math.max(1, Math.round(duration * project.sampleRate));
		sourceDurationFrames = clip.sourceDurationFrames;
	} else if (clip.warpMap != null) {
		const source = { sampleRate: sourceRate, frameCount: clip.sourceStartFrame + clip.sourceDurationFrames };
		const timingProject = { sampleRate: project.sampleRate, tempoMap: project.tempoMap as unknown as HoldTempoMap };
		const range = clipSourceDisplayRange(clip, source, project.sampleRate);
		const sourceEnd = Math.min(source.frameCount, sourceStartFrame + sourceDurationFrames);
		sourceStartFrame = Math.max(clip.sourceStartFrame, Math.min(sourceStartFrame, sourceEnd - 1));
		sourceDurationFrames = sourceEnd - sourceStartFrame;
		timelineStartFrame = clip.timelineStartFrame + Math.round(clipSourceFrameToDisplay(timingProject, clip, source, sourceStartFrame) - range.startFrame);
		durationFrames = Math.max(1, Math.round(clipSourceFrameToDisplay(timingProject, clip, source, sourceEnd) - range.startFrame) + clip.timelineStartFrame - timelineStartFrame);
	} else {
		const ratio = clip.durationFrames / clip.sourceDurationFrames;
		durationFrames = Math.max(1, Math.round(sourceDurationFrames * ratio));
		const timelineEnd = clip.timelineStartFrame + clip.durationFrames;
		timelineStartFrame = (edge === 'left') !== (clip.reversed === true) ? timelineEnd - durationFrames : clip.timelineStartFrame;
		if (timelineStartFrame < 0) {
			timelineStartFrame = 0; durationFrames = timelineEnd;
			sourceDurationFrames = Math.max(1, Math.round(durationFrames / ratio));
			if (edge === 'left') sourceStartFrame = clip.sourceStartFrame + clip.sourceDurationFrames - sourceDurationFrames;
		}
	}
	return { changes: { timelineStartFrame, sourceStartFrame, durationFrames }, sourceDurationFrames };
}
