/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipOwnerIndex, createRelatedClipReader, firstById, requireIndexedClip } from './editing-work-index.ts';

export interface RenderedGeometryClip {
	readonly id: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly groupId?: string | null;
	readonly avLinkId?: string | null;
}
interface GeometryTrack { readonly id: string; readonly clipIds?: readonly string[] }
interface GeometryEntry<Clip extends RenderedGeometryClip> {
	readonly clip: Clip;
	readonly source: Readonly<{ frameCount: number }>;
	readonly ratio: number;
}
interface GeometryStep<Clip extends RenderedGeometryClip, Track extends GeometryTrack, Entry> {
	readonly relatedIds: ReadonlySet<string>;
	readonly related: readonly Clip[];
	readonly targets: readonly Entry[];
	readonly relatedTracks: ReadonlySet<Track>;
	readonly ratio: number;
	readonly anchor: number;
	readonly oldEnd: number;
	readonly delta: number;
}

/** Read current geometry between components, after earlier replacements have rippled it. */
export function* renderedClipGeometrySteps<Clip extends RenderedGeometryClip, Track extends GeometryTrack,
	Entry extends GeometryEntry<Clip>>(
	clips: readonly Clip[], tracks: readonly Track[], entries: readonly Entry[],
	clipById = firstById(clips),
): Generator<GeometryStep<Clip, Track, Entry>> {
	const owners = clipOwnerIndex(tracks);
	const remaining = new Set(entries.map(entry => entry.clip.id));
	const slots = new Map<string, number>();
	for (const [index, clip] of clips.entries()) if (!slots.has(clip.id)) slots.set(clip.id, index);
	const entryById = new Map<string, { entry: Entry; index: number }[]>();
	for (const [index, entry] of entries.entries()) {
		const duplicates = entryById.get(entry.clip.id) ?? [];
		duplicates.push({ entry, index });
		entryById.set(entry.clip.id, duplicates);
	}
	const readRelated = createRelatedClipReader(clips, clipById.size === clips.length ? clipById : undefined);
	const components: { relatedIds: Set<string>; targets: Entry[]; ratio: number }[] = [];
	while (remaining.size) {
		const seed = remaining.values().next().value!;
		const relatedIds = new Set(readRelated([seed]));
		const targets = [...relatedIds].flatMap(id => entryById.get(id) ?? [])
			.sort((left, right) => left.index - right.index).map(item => item.entry);
		for (const { clip } of targets) remaining.delete(clip.id);
		const ratio = targets[0]!.ratio;
		if (targets.some(target => Math.abs(target.ratio - ratio) > 1 / Math.max(1, target.clip.durationFrames))) {
			throw new RangeError('Related clips produced inconsistent effect duration ratios.');
		}
		components.push({ relatedIds, targets, ratio });
	}
	for (const { relatedIds, targets, ratio } of components) {
		const related = [...relatedIds].sort((left, right) => slots.get(left)! - slots.get(right)!)
			.map(id => requireIndexedClip(clipById, id));
		const anchor = Math.min(...related.map(clip => clip.timelineStartFrame));
		const oldEnd = Math.max(...related.map(clip => clip.timelineStartFrame + clip.durationFrames));
		const relatedTracks = new Set(related.map(clip => {
			const track = owners.get(clip.id);
			if (!track) throw new ReferenceError('Rendered clip is not assigned to a track.');
			return track;
		}));
		yield { relatedIds, targets, related, relatedTracks, ratio, anchor, oldEnd,
			delta: anchor + Math.max(1, Math.round((oldEnd - anchor) * ratio)) - oldEnd };
	}
}

export function renderedClipPlacement(
	step: Readonly<{ anchor: number; ratio: number }>, clip: RenderedGeometryClip, frameCount?: number,
): Readonly<{ timelineStartFrame: number; durationFrames: number }> {
	return { timelineStartFrame: step.anchor + Math.round((clip.timelineStartFrame - step.anchor) * step.ratio),
		durationFrames: frameCount ?? Math.max(1, Math.round(clip.durationFrames * step.ratio)) };
}

/** Track ripple follows ownership, including unchanged related clips on another lane. */
export function renderedClipRipplePlacements<Clip extends RenderedGeometryClip, Track extends GeometryTrack>(
	step: GeometryStep<Clip, Track, unknown>, clipById: ReadonlyMap<string, Clip>,
): readonly Readonly<{ clip: Clip; timelineStartFrame: number }>[] {
	if (step.delta === 0) return [];
	return [...step.relatedTracks].flatMap(track => (track.clipIds ?? []).flatMap(id => {
		const clip = requireIndexedClip(clipById, id);
		return !step.relatedIds.has(id) && clip.timelineStartFrame >= step.oldEnd
			? [{ clip, timelineStartFrame: clip.timelineStartFrame + step.delta }] : [];
	}));
}
