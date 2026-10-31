/* SPDX-License-Identifier: AGPL-3.0-only */

import { exportSequenceProject } from '../../export-sequence-project.ts';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, isCurrentProjectSchemaIdentity } from '../../project-schema-identity.ts';
import { brandRuntimeProjectProjection, isRuntimeProjectProjection } from '../../runtime-clip-projection.ts';
import { inheritTrackFolderMediaStateProjectionV12 } from '../../track-folder-media-runtime.ts';

type Data = Readonly<Record<string, unknown>>;

/** Focus belongs to an actually selected clip; a remembered ID cannot change it. */
export function focusedVideoPreviewSequenceId(projectValue: unknown, preferredClipId: unknown): string | null {
	if (!isCurrentProjectSchemaIdentity(projectValue, FRAMESCAPER_PROJECT_SCHEMA_FAMILY)) return null;
	const project = record(projectValue);
	if (!project) return null;
	const selectedIds = record(project.selection)?.clipIds;
	if (!Array.isArray(selectedIds)) return null;
	const ids = selectedIds.filter((id): id is string => typeof id === 'string');
	if (typeof preferredClipId === 'string' && ids.includes(preferredClipId)) {
		ids.splice(ids.indexOf(preferredClipId), 1); ids.unshift(preferredClipId);
	}
	const clips = records(project.clips), sequences = records(project.sequences);
	for (const id of ids) {
		const sequenceId = clips.find(clip => clip.id === id)?.sequenceId;
		if (typeof sequenceId === 'string' && sequences.some(sequence => sequence.id === sequenceId)) return sequenceId;
	}
	return null;
}

/** Keep the authored graph complete while scoping only its native playback view. */
export function focusVideoPreviewProjects<Canonical, Preview>(
	canonicalProject: Canonical,
	project: Preview,
	sequenceId: string | null,
): Readonly<{ canonicalProject: Canonical; project: Preview }> {
	const canonical = record(canonicalProject), preview = record(project);
	if (sequenceId === null || !canonical || !preview
		|| !isCurrentProjectSchemaIdentity(canonical, FRAMESCAPER_PROJECT_SCHEMA_FAMILY)
		|| !records(canonical.sequences).some(sequence => sequence.id === sequenceId)) {
		return { canonicalProject, project };
	}
	const focusedCanonical = canonical.primarySequenceId === sequenceId
		? canonicalProject : Object.freeze({ ...canonical, primarySequenceId: sequenceId }) as Canonical;
	const scoped = exportSequenceProject({ ...preview, primarySequenceId: sequenceId }, sequenceId);
	const focusedPreview = inheritTrackFolderMediaStateProjectionV12(preview, scoped);
	if (isRuntimeProjectProjection(preview)) brandRuntimeProjectProjection(focusedPreview);
	return { canonicalProject: focusedCanonical, project: focusedPreview as Preview };
}

function record(value: unknown): Data | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : null;
}

function records(value: unknown): readonly Data[] {
	return Array.isArray(value) ? value.flatMap(item => { const entry = record(item); return entry ? [entry] : []; }) : [];
}
