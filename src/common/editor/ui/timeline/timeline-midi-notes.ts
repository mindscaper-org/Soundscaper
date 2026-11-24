/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop } from '../../audio-clip-loop.ts';
import { buildAudioWarpRuntimeSegments, type AudioWarpRuntimeClip, type AudioWarpRuntimeProject } from '../../audio-warp-runtime.ts';
import { readMidiClip, type MidiNote } from '../../midi-model.ts';

interface TimelineMidiClip {
	readonly kind?: unknown;
	readonly opaqueExtensions?: unknown;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames?: number;
	readonly waveformStartFrame: number;
	readonly waveformEndFrame: number;
	readonly reversed?: boolean;
	readonly warpMap?: unknown;
}

interface MidiNoteSpan {
	readonly pitch: number;
	readonly start: number;
	readonly end: number;
}

export interface TimelineMidiNotePreview {
	readonly spans: readonly MidiNoteSpan[];
	readonly pitchMin: number;
	readonly pitchMax: number;
	readonly windowStart: number;
	readonly windowLength: number;
	readonly period: number | null;
}

// Reuse compact decodes across projection passes without retaining decoded
// scores for carriers kept alive by undo history.
const notesByCarrier = new WeakMap<object, WeakRef<readonly MidiNote[]> | null>();

export function readTimelineMidiNotes(clip: Pick<TimelineMidiClip, 'kind' | 'opaqueExtensions'>): readonly MidiNote[] | null {
	const carrier = clip.opaqueExtensions;
	if (clip.kind !== 'audio' || carrier === null || typeof carrier !== 'object') return null;
	const reference = notesByCarrier.get(carrier);
	const cached = reference === null ? null : reference?.deref();
	if (cached !== undefined) return cached;
	const notes = readMidiClip(clip)?.notes ?? null;
	notesByCarrier.set(carrier, notes ? new WeakRef(notes) : null);
	return notes;
}

/** Project a single pass of the source into clip-relative project frames. */
export function projectTimelineMidiNotes(clip: TimelineMidiClip, project?: AudioWarpRuntimeProject | null): TimelineMidiNotePreview | null {
	const notes = readTimelineMidiNotes(clip);
	if (!notes) return null;
	const loop = readClipLoop(clip);
	const sourceStart = clip.sourceStartFrame;
	const sourceDuration = clip.sourceDurationFrames ?? clip.durationFrames;
	const sourceEnd = sourceStart + sourceDuration;
	const duration = loop?.periodFrames ?? clip.durationFrames;
	const toLocalFrame = clip.warpMap != null && project
		? warpedNoteProjector(project, { ...clip, sourceDurationFrames: sourceDuration } as AudioWarpRuntimeClip)
		: (frame: number) => (clip.reversed ? sourceEnd - frame : frame - sourceStart) * duration / sourceDuration;
	const spans: MidiNoteSpan[] = [];
	let pitchMin = 127;
	let pitchMax = 0;
	for (const note of notes) {
		const start = Math.max(sourceStart, note.startFrame);
		const end = Math.min(sourceEnd, note.startFrame + note.durationFrames);
		if (end <= start) continue;
		spans.push({ pitch: note.pitch, start: toLocalFrame(clip.reversed ? end : start), end: toLocalFrame(clip.reversed ? start : end) });
		pitchMin = Math.min(pitchMin, note.pitch);
		pitchMax = Math.max(pitchMax, note.pitch);
	}
	return {
		spans, pitchMin, pitchMax,
		period: loop?.periodFrames ?? null,
		windowStart: loop ? (clip.waveformStartFrame % loop.periodFrames + loop.offsetFrames) % loop.periodFrames : clip.waveformStartFrame,
		windowLength: clip.waveformEndFrame - clip.waveformStartFrame,
	};
}

function warpedNoteProjector(project: AudioWarpRuntimeProject, clip: AudioWarpRuntimeClip): (frame: number) => number {
	const segments = buildAudioWarpRuntimeSegments(project, clip, {
		startFrame: clip.timelineStartFrame, endFrame: clip.timelineStartFrame + clip.durationFrames,
		sourceSampleRate: project.sampleRate,
	}).map(segment => ({
		start: segment.sourceStartFrame.num / segment.sourceStartFrame.den,
		end: segment.sourceEndFrame.num / segment.sourceEndFrame.den,
		localStart: segment.timelineStartFrame - clip.timelineStartFrame,
		length: segment.timelineEndFrame - segment.timelineStartFrame,
	}));
	return frame => {
		let low = 0;
		let high = segments.length - 1;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if (frame > segments[middle]!.end) low = middle + 1;
			else high = middle;
		}
		const segment = segments[low]!;
		return segment.localStart + (frame - segment.start) / (segment.end - segment.start) * segment.length;
	};
}
