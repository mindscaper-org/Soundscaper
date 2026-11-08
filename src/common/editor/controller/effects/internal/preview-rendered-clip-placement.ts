/* SPDX-License-Identifier: AGPL-3.0-only */

import { renderedClipGeometrySteps, renderedClipPlacement, renderedClipRipplePlacements,
	type RenderedGeometryClip } from '../../../commands/rendered-clip-geometry.ts';
import { createCompletedFrameSum, createRelatedClipReader, firstById } from '../../../commands/editing-work-index.ts';
import { mergeEditingRanges } from '../../../commands/editing-selection-authority.ts';

export interface PreviewGeometryProject {
	readonly clips: readonly RenderedGeometryClip[];
	readonly tracks: readonly Readonly<{ id: string; clipIds?: readonly string[] }>[];
}
interface PreviewGeometryResult { readonly clipId: string; readonly frameCount: number }

/** Run the same component placement and track ripple as exact-clip effect publication. */
export function previewRenderedClipStarts(project: PreviewGeometryProject, results: readonly PreviewGeometryResult[]): readonly number[] {
	const clips = project.clips.map(clip => ({ ...clip }));
	const byId = firstById(clips);
	const entries = results.filter(result => result.frameCount > 0).map(result => {
		const clip = byId.get(result.clipId);
		if (!clip) throw new ReferenceError(`Unknown clip: ${result.clipId}.`);
		return { clip, source: { frameCount: result.frameCount }, ratio: result.frameCount / clip.durationFrames };
	});
	const removed = new Set(createRelatedClipReader(clips)(results.filter(result => result.frameCount === 0).map(result => result.clipId)));
	if (entries.some(entry => removed.has(entry.clip.id))) throw new RangeError('Related clips produced inconsistent effect duration ratios.');
	for (const step of renderedClipGeometrySteps(clips, project.tracks, entries, byId)) {
		for (const placement of renderedClipRipplePlacements(step, byId)) placement.clip.timelineStartFrame = placement.timelineStartFrame;
		const targets = new Map(step.targets.map(entry => [entry.clip.id, entry.source.frameCount]));
		for (const clip of step.related) Object.assign(clip, renderedClipPlacement(step, clip, targets.get(clip.id)));
	}
	for (const track of project.tracks) {
		const owned = (track.clipIds ?? []).map(id => byId.get(id)!);
		const ranges = mergeEditingRanges(owned.filter(clip => removed.has(clip.id))
			.map(clip => ({ startFrame: clip.timelineStartFrame, endFrame: clip.timelineStartFrame + clip.durationFrames })));
		const shiftAt = createCompletedFrameSum(ranges.map(range => ({ endFrame: range.endFrame, frames: range.endFrame - range.startFrame })));
		for (const clip of owned) if (!removed.has(clip.id)) clip.timelineStartFrame -= shiftAt(clip.timelineStartFrame);
	}
	return results.map(result => byId.get(result.clipId)!.timelineStartFrame);
}

/** Lightweight fixtures and legacy callers can provide the selected clip geometry alone. */
export function previewGeometryFromTargets(targets: readonly Readonly<{
	clipId: string; startFrame: number; durationFrames: number; track: Readonly<{ id: string }>;
}>[]): PreviewGeometryProject {
	const tracks = new Map<string, { id: string; clipIds: string[] }>();
	for (const target of targets) {
		const track = tracks.get(target.track.id) ?? { id: target.track.id, clipIds: [] };
		track.clipIds.push(target.clipId);
		tracks.set(track.id, track);
	}
	return { clips: targets.map(target => ({ id: target.clipId, timelineStartFrame: target.startFrame, durationFrames: target.durationFrames })),
		tracks: [...tracks.values()] };
}
