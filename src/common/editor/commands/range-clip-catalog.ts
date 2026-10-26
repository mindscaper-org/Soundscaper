/* SPDX-License-Identifier: AGPL-3.0-only */

import { findProjectBinClip } from '../project.js';
import { firstById } from './editing-work-index.ts';

interface Identified { readonly id: string }
interface Track extends Identified { readonly clipIds?: readonly string[] }

/** Stage disjoint track replacements in their original catalog order for one owned edit. */
export function createRangeClipCatalog<Clip extends Identified>(project: { clips: Clip[]; tracks: readonly Track[] }, trackIds: readonly string[]) {
	const byId = firstById(project.clips), ownerIds = new Set<string>();
	// Generic callers may have shared ownership or repeated targets; retain sequential semantics there.
	if (byId.size !== project.clips.length || new Set(trackIds).size !== trackIds.length) return null;
	for (const track of project.tracks) {
		for (const id of track.clipIds ?? []) {
			if (ownerIds.has(id)) return null;
			ownerIds.add(id);
		}
	}
	const live = new Set(byId.keys()), removed = new Set<string>(), appended: Clip[] = [];
	return {
		read(track: Track): Clip[] {
			return (track.clipIds ?? []).map(id => {
				const clip = byId.get(id);
				if (!clip) throw new ReferenceError(`Unknown clip: ${id}.`);
				return clip;
			});
		},
		assertUnused(id: string): void {
			if (live.has(id) || findProjectBinClip(project, id)) throw new RangeError(`Duplicate clip ID: ${id}.`);
		},
		stage(track: Track, clips: readonly Clip[]): void {
			for (const id of track.clipIds ?? []) { removed.add(id); live.delete(id); }
			for (const clip of clips) live.add(clip.id);
			appended.push(...clips);
		},
		commit(): void { project.clips = [...project.clips.filter(clip => !removed.has(clip.id)), ...appended]; },
	};
}
