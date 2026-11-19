/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ClipFadeEdge } from './clip-fade-geometry.ts';
import { firstById } from '../../commands/editing-work-index.ts';
import {
	clipFadeEditsCommand, clipFadeEditsPreviews, planSelectedClipFadeEdits,
	planSelectedClipFadeCommand, clipFadeEditIntent,
} from './selected-clip-fades.ts';
import type { ClipFadeTarget, SelectedClipFadeChanges, SelectedClipFadeEdit } from './selected-clip-fades.ts';

interface FadeProject {
	readonly clips: readonly ClipFadeTarget[];
	readonly tracks: readonly Readonly<{ id: string; clipIds?: readonly string[] }>[];
	readonly selection?: Readonly<{ clipIds?: readonly string[] }>;
}

interface FadeSession {
	readonly clipId: string;
	readonly original: ClipFadeTarget;
	readonly fadeTargets?: readonly ClipFadeTarget[];
}

export function clipFadeChangeCommand(project: FadeProject, clipId: string, sampleRate: number,
	changes: SelectedClipFadeChanges, editedEdge?: ClipFadeEdge) {
	return planSelectedClipFadeCommand({ clips: project.clips, editedClipId: clipId,
		selectedIds: project.selection?.clipIds ?? [], sampleRate,
		edit: clipFadeEditIntent(changes, editedEdge),
	});
}

/** Captured targets keep the same native participants throughout one pointer gesture. */
export function clipFadeSessionPreviews(session: FadeSession, project: FadeProject, sampleRate: number, edit: SelectedClipFadeEdit) {
	const clips = session.fadeTargets ?? [session.original];
	const edits = planSelectedClipFadeEdits({ clips, editedClipId: session.clipId,
		selectedIds: clips.map(clip => clip.id), sampleRate, edit });
	const pending = new Set(edits.map(({ clipId }) => clipId));
	const owners = new Map<string, string>();
	// Start with the last track so duplicate memberships keep the existing owner.
	for (let index = project.tracks.length - 1; index >= 0 && pending.size; index--) {
		const track = project.tracks[index]!;
		for (const id of track.clipIds ?? []) {
			if (pending.delete(id)) owners.set(id, track.id);
			if (!pending.size) break;
		}
	}
	return { previews: clipFadeEditsPreviews(edits, owners) };
}

/** Reject stale captured fades before native batch validation and lock admission. */
export function clipFadeSessionCommand(session: FadeSession, project: FadeProject, sampleRate: number, edit: SelectedClipFadeEdit) {
	const clips = session.fadeTargets ?? [session.original];
	const byId = clips.length > 1 ? firstById(project.clips) : null;
	for (const original of clips) {
		const current = byId ? byId.get(original.id) : project.clips.find(clip => clip.id === original.id);
		if (!current || (['timelineStartFrame', 'durationFrames', 'fadeInFrames', 'fadeOutFrames', 'fadeInShape', 'fadeOutShape'] as const)
			.some(field => current[field] !== original[field])) return null;
	}
	return clipFadeEditsCommand(planSelectedClipFadeEdits({ clips, editedClipId: session.clipId,
		selectedIds: clips.map(clip => clip.id), sampleRate, edit }));
}
