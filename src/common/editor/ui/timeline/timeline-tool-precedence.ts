/* SPDX-License-Identifier: AGPL-3.0-only */

import { snapAudioEditorFrameWithProject } from '../../snap-grid.js';
import { adjacentSplitToolBoundaries, splitToolClipIndex, splitToolItemBoundaries } from './split-tool-item-index.ts';
import { SPLIT_TOOL_INDEX_ENTRY_LIMIT } from './split-tool-cache-budget.ts';

interface TimelineToolPrecedenceInput {
	readonly automationToolEnabled: boolean;
	readonly spectralBrushEnabled: boolean;
	readonly splitToolActive: boolean;
}

export interface TimelineToolPrecedence {
	readonly automationToolEnabled: boolean;
	readonly spectralBrushEnabled: boolean;
	readonly showAutomationOverlay: boolean;
}

interface SplitToolTrack {
	readonly id: string;
	readonly type?: string;
	readonly clipIds?: readonly unknown[];
	readonly labels?: readonly SplitToolLabel[];
}

interface SplitToolClip {
	readonly id: unknown;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

interface SplitToolLabel {
	readonly startFrame: number;
	readonly endFrame: number;
}

interface SplitToolTimelineAnnotation {
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
}

interface SplitToolProject {
	readonly clips: readonly SplitToolClip[];
	readonly sampleRate?: number;
	readonly snap?: Readonly<{ readonly enabled?: boolean }>;
	readonly timelineAnnotations?: readonly SplitToolTimelineAnnotation[];
	readonly tracks: readonly SplitToolTrack[];
	readonly [extension: string]: unknown;
}

interface SplitToolGuidelineInput {
	readonly frame: number;
	readonly pixelsPerSecond: number;
	readonly project: SplitToolProject;
	readonly sampleRate: number;
}

/** Audacity requires ten horizontal pixels before pointer release makes a second split. */
export const SPLIT_TOOL_DOUBLE_SPLIT_DISTANCE_PIXELS = 10;
/** Audacity's disabled-grid item snap accepts the nearest edge through four pixels. */
export const SPLIT_TOOL_ITEM_SNAP_TOLERANCE_PIXELS = 4;

/** Resolve the release-time Shift modifier independently for each Split action. */
export function splitToolTargetTrackIds(
	tracks: readonly SplitToolTrack[],
	trackId: string,
	shiftKey: boolean,
): string[] {
	const target = tracks.find((track) => track.id === trackId);
	if (!splitToolTrackSplittable(target)) return [];
	return shiftKey
		? tracks.filter(splitToolTrackSplittable).map((track) => track.id)
		: [trackId];
}

/** Match Audacity's grid snap, or its disabled-grid clip/label edge magnetism. */
export function resolveSplitToolGuidelineFrame({
	frame,
	pixelsPerSecond,
	project,
	sampleRate,
}: SplitToolGuidelineInput): number {
	const inputFrame = Math.round(frame);
	if (project.snap?.enabled) {
		return snapAudioEditorFrameWithProject(inputFrame, { ...project, sampleRate });
	}
	const boundaries = splitToolItemBoundaries(project.clips, project.tracks, project.timelineAnnotations);
	let nearest = inputFrame;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const boundary of pixelsPerSecond > 0 && sampleRate > 0 ? adjacentSplitToolBoundaries(boundaries, inputFrame) : boundaries) {
		const distance = splitToolGuidelineDistancePixels(
			inputFrame, boundary, pixelsPerSecond, sampleRate,
		);
		if (distance > SPLIT_TOOL_ITEM_SNAP_TOLERANCE_PIXELS) continue;
		if (distance < nearestDistance || (distance === nearestDistance && boundary > nearest)) {
			nearest = boundary;
			nearestDistance = distance;
		}
	}
	return nearest;
}

/** Project a pair of sample-frame guidelines into their horizontal pixel distance. */
export function splitToolGuidelineDistancePixels(
	startFrame: number,
	endFrame: number,
	pixelsPerSecond: number,
	sampleRate: number,
): number {
	return Math.abs(endFrame - startFrame) * pixelsPerSecond / sampleRate;
}

/** Audacity performs both press and release splits only over a clip. */
export function splitToolTrackHasClipAt(
	tracks: readonly SplitToolTrack[],
	clips: readonly SplitToolClip[],
	trackId: string,
	frame: number,
): boolean {
	const track = tracks.find((candidate) => candidate.id === trackId);
	if (!splitToolTrackSplittable(track)) return false;
	const byId = clips.length > 128 && clips.length <= SPLIT_TOOL_INDEX_ENTRY_LIMIT && Object.isFrozen(clips) ? splitToolClipIndex(clips) : null;
	return track.clipIds.some((clipId) => {
		if (typeof clipId === 'number' && Number.isNaN(clipId)) return false;
		const clip = byId ? byId.get(clipId) : clips.find(candidate => candidate.id === clipId);
		return Boolean(clip && frame >= clip.timelineStartFrame
			&& frame <= clip.timelineStartFrame + clip.durationFrames);
	});
}

function splitToolTrackSplittable(track: SplitToolTrack | undefined): track is SplitToolTrack & {
	readonly clipIds: readonly unknown[];
} {
	return Boolean(track && track.type !== 'label' && Array.isArray(track.clipIds));
}

/** Split is a pointer-owning tool, including during its momentary key hold. */
export function resolveTimelineToolPrecedence({
	automationToolEnabled,
	spectralBrushEnabled,
	splitToolActive,
}: TimelineToolPrecedenceInput): TimelineToolPrecedence {
	return Object.freeze({
		automationToolEnabled: Boolean(automationToolEnabled && !splitToolActive),
		spectralBrushEnabled: Boolean(spectralBrushEnabled && !splitToolActive),
		showAutomationOverlay: !splitToolActive,
	});
}
