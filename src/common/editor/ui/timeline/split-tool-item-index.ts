/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSplitToolIndexBudget } from './split-tool-cache-budget.ts';

interface Clip { readonly id: unknown; readonly timelineStartFrame: number; readonly durationFrames: number; }
interface Label { readonly startFrame: number; readonly endFrame: number; }
interface Track { readonly clipIds?: readonly unknown[]; readonly labels?: readonly Label[]; }
interface Annotation { readonly timelineStartFrame: number; readonly timelineEndFrame: number; }
const EMPTY_ANNOTATIONS: readonly Annotation[] = Object.freeze([]);
const budget = createSplitToolIndexBudget();
const clipIndexes = budget.cache<readonly Clip[], ReadonlyMap<unknown, Clip>>();
const edgeIndexes = budget.cache<readonly Clip[], Readonly<{ tracks: WeakRef<readonly Track[]>; annotations: WeakRef<readonly Annotation[]>; boundaries: readonly number[] }>>();

/** A snapshot list owns its identity index; mutable arrays are never retained. */
export function splitToolClipIndex(clips: readonly Clip[]): ReadonlyMap<unknown, Clip> {
	const previous = clipIndexes.get(clips);
	if (previous) return previous;
	const index = new Map<unknown, Clip>();
	for (const clip of clips) { const id = clip.id; if (!index.has(id)) index.set(id, clip); }
	if (Object.isFrozen(clips) && clips.every(Object.isFrozen)) clipIndexes.set(clips, index, index.size);
	return index;
}

/** Only the latest tuple belongs to each clip list; its other owners stay weak. */
export function splitToolItemBoundaries(clips: readonly Clip[], tracks: readonly Track[], annotations = EMPTY_ANNOTATIONS): readonly number[] {
	const previous = edgeIndexes.get(clips);
	if (previous && previous.tracks.deref() === tracks && previous.annotations.deref() === annotations) return previous.boundaries;
	const ids = new Set<unknown>();
	const boundaries: number[] = [];
	const add = (start: number, end: number) => { if (Number.isFinite(start)) boundaries.push(start); if (Number.isFinite(end)) boundaries.push(end); };
	for (const track of tracks) {
		for (const id of track.clipIds ?? []) ids.add(id);
		for (const label of track.labels ?? []) add(label.startFrame, label.endFrame);
	}
	for (const clip of clips) if (ids.has(clip.id)) { const start = clip.timelineStartFrame; add(start, start + clip.durationFrames); }
	for (const annotation of annotations) add(annotation.timelineStartFrame, annotation.timelineEndFrame);
	boundaries.sort((left, right) => left - right);
	if (Object.isFrozen(clips) && Object.isFrozen(tracks) && Object.isFrozen(annotations)
		&& clips.every(Object.isFrozen) && annotations.every(Object.isFrozen)
		&& tracks.every(track => Object.isFrozen(track) && (!track.clipIds || Object.isFrozen(track.clipIds))
			&& (!track.labels || (Object.isFrozen(track.labels) && track.labels.every(Object.isFrozen))))) {
		edgeIndexes.set(clips, { tracks: new WeakRef(tracks), annotations: new WeakRef(annotations), boundaries }, boundaries.length);
	}
	return boundaries;
}

export function adjacentSplitToolBoundaries(boundaries: readonly number[], frame: number): readonly number[] {
	let low = 0, high = boundaries.length;
	while (low < high) { const middle = (low + high) >>> 1; if (boundaries[middle]! < frame) low = middle + 1; else high = middle; }
	return boundaries.slice(Math.max(0, low - 1), low + 1);
}
