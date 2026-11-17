/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	brandRuntimeProjectProjection, isRuntimeProjectProjection, type RuntimeClipProject,
} from '../common/editor/runtime-clip-projection.ts';

/** Scope picture and range resolution to the programme after nested playback is materialized. */
export function framescaperVideoExportPrimarySequence<Project extends RuntimeClipProject>(project: Project): Project {
	if (project.sequences?.length === 1) return project;
	const sequence = project.sequences?.find(({ id }) => id === project.primarySequenceId);
	if (!sequence || !Array.isArray(sequence.trackIds) || !Array.isArray(sequence.trackNodes)) {
		throw new ReferenceError('The video export primary sequence is unavailable.');
	}
	const trackIds = new Set<unknown>(sequence.trackIds);
	const folderIds = new Set<unknown>(sequence.trackNodes.filter(node => node.kind === 'folder').map(node => node.id));
	const tracks = (project.tracks as readonly Readonly<Record<string, unknown>>[]).filter(({ id }) => trackIds.has(id));
	const clipIds = new Set(tracks.flatMap(track => Array.isArray(track.clipIds) ? track.clipIds : []));
	const clips = project.clips?.filter(({ id }) => clipIds.has(id));
	const trackFolders = (project.trackFolders as readonly Readonly<Record<string, unknown>>[]).filter(({ id }) => folderIds.has(id));
	const scoped = { ...project, sequences: [sequence], trackFolders, tracks, clips };
	return isRuntimeProjectProjection(project) ? brandRuntimeProjectProjection(scoped) : scoped;
}
