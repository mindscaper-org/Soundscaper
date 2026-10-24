/* SPDX-License-Identifier: AGPL-3.0-only */

interface Clip { readonly id: unknown; readonly timelineStartFrame: number; readonly durationFrames: number; }
interface Label { readonly startFrame: number; readonly endFrame: number; }
interface Track { readonly clipIds?: readonly unknown[]; readonly labels?: readonly Label[]; }
interface Annotation { readonly timelineStartFrame: number; readonly timelineEndFrame: number; }
const EMPTY_ANNOTATIONS: readonly Annotation[] = Object.freeze([]);
const clipIndexes = new WeakMap<readonly Clip[], ReadonlyMap<unknown, Clip>>();
const edgeIndexes = new WeakMap<readonly Clip[], WeakMap<readonly Track[], WeakMap<readonly Annotation[], readonly number[]>>>();

/** A snapshot list owns its identity index; mutable arrays are never retained. */
export function splitToolClipIndex(clips: readonly Clip[]): ReadonlyMap<unknown, Clip> {
	const previous = clipIndexes.get(clips);
	if (previous) return previous;
	const index = new Map<unknown, Clip>();
	for (const clip of clips) { const id = clip.id; if (!index.has(id)) index.set(id, clip); }
	if (Object.isFrozen(clips) && clips.every(Object.isFrozen)) clipIndexes.set(clips, index);
	return index;
}

/** All three collections are weak owners, without retaining superseded snapshots. */
export function splitToolItemBoundaries(clips: readonly Clip[], tracks: readonly Track[], annotations = EMPTY_ANNOTATIONS): readonly number[] {
	let byTracks = edgeIndexes.get(clips);
	let byAnnotations = byTracks?.get(tracks);
	const previous = byAnnotations?.get(annotations);
	if (previous) return previous;
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
		if (!byTracks) { byTracks = new WeakMap(); edgeIndexes.set(clips, byTracks); }
		if (!byAnnotations) { byAnnotations = new WeakMap(); byTracks.set(tracks, byAnnotations); }
		byAnnotations.set(annotations, boundaries);
	}
	return boundaries;
}

export function adjacentSplitToolBoundaries(boundaries: readonly number[], frame: number): readonly number[] {
	let low = 0, high = boundaries.length;
	while (low < high) { const middle = (low + high) >>> 1; if (boundaries[middle]! < frame) low = middle + 1; else high = middle; }
	return boundaries.slice(Math.max(0, low - 1), low + 1);
}
