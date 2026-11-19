/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveTrackNodeSpanV12 } from './track-hierarchy-mutation-v12.ts';
import type { TrackNodeV12 } from './track-hierarchy-v12.ts';

export interface FolderContentProject {
	readonly tracks: readonly Readonly<{ id: string; clipIds?: readonly string[]; locked?: boolean }>[];
	readonly clips: readonly Readonly<{ id: string; timelineStartFrame: number; durationFrames: number; avLinkId?: string | null }>[];
	readonly sequences?: readonly Readonly<{ id: string; trackNodes: readonly TrackNodeV12[] }>[];
}

export interface FolderContentRange { readonly startFrame: number; readonly endFrame: number }
export interface FolderContentTarget {
	readonly sequenceId: string;
	readonly trackIds: readonly string[];
	readonly range: FolderContentRange | null;
}

export class FolderContentEditError extends RangeError {
	constructor(readonly copyKey: 'folderContentLocked' | 'folderContentLinkOutside', message: string) { super(message); }
}

/** Resolve the subtree from the document, including descendants whose rows are collapsed or hidden. */
export function folderContentTarget(project: FolderContentProject, folderId: string): FolderContentTarget {
	for (const sequence of project.sequences ?? []) {
		if (!sequence.trackNodes.some(node => node.id === folderId && node.kind === 'folder')) continue;
		const span = resolveTrackNodeSpanV12(sequence.trackNodes, folderId);
		const media = new Set(project.tracks.filter(track => Array.isArray(track.clipIds)).map(track => track.id));
		const trackIds = sequence.trackNodes.slice(span.start, span.end)
			.filter(node => node.kind === 'track' && media.has(node.id)).map(node => node.id);
		const ranges = folderContentSpans(project, trackIds);
		return { sequenceId: sequence.id, trackIds, range: ranges.length
			? { startFrame: ranges[0]!.startFrame, endFrame: ranges.at(-1)!.endFrame } : null };
	}
	throw new ReferenceError(`Unknown track folder: ${folderId}.`);
}

/** A compact overview of occupied time; no waveform or second clip identity is authored. */
export function folderContentSpans(project: FolderContentProject, trackIds: readonly string[]): readonly FolderContentRange[] {
	const tracks = new Set(trackIds);
	const clips = new Set(project.tracks.filter(track => tracks.has(track.id)).flatMap(track => track.clipIds ?? []));
	const ranges = project.clips.filter(clip => clips.has(clip.id))
		.map(clip => ({ startFrame: clip.timelineStartFrame, endFrame: clip.timelineStartFrame + clip.durationFrames }))
		.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
	const result: { startFrame: number; endFrame: number }[] = [];
	for (const range of ranges) {
		const previous = result.at(-1);
		if (previous && range.startFrame <= previous.endFrame) previous.endFrame = Math.max(previous.endFrame, range.endFrame);
		else result.push({ ...range });
	}
	return result;
}

/** A folder edit never silently reaches an outside A/V partner or edits a locked descendant. */
export function assertFolderContentEditable(project: FolderContentProject, trackIds: readonly string[]): void {
	const tracks = new Set(trackIds);
	if (project.tracks.some(track => tracks.has(track.id) && track.locked)) throw new FolderContentEditError('folderContentLocked', 'A track in this folder is locked.');
	const clipIds = new Set(project.tracks.filter(track => tracks.has(track.id)).flatMap(track => track.clipIds ?? []));
	const links = new Set(project.clips.filter(clip => clipIds.has(clip.id) && clip.avLinkId).map(clip => clip.avLinkId));
	if (project.clips.some(clip => !clipIds.has(clip.id) && clip.avLinkId && links.has(clip.avLinkId))) {
		throw new FolderContentEditError('folderContentLinkOutside', 'A linked audio/video partner is outside this folder.');
	}
}
