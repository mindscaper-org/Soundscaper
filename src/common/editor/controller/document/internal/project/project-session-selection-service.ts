/* SPDX-License-Identifier: AGPL-3.0-only */

import { isActiveAudioEditorProjectSchema } from '../../../../project-schema-version.ts';
import type { SelectedLabelState } from '../../../../label-clipboard-selection.ts';

export interface ProjectSessionSelectionState extends SelectedLabelState {
	selectedTrackId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId: string | null;
}

export interface ProjectSessionSelectionTrack {
	readonly id: string;
	readonly type: string;
}

export interface ProjectSessionSelectionProject {
	readonly schemaVersion?: unknown;
	readonly selection?: unknown;
	readonly timelineAnnotations?: unknown;
	readonly tracks: readonly ProjectSessionSelectionTrack[];
}

export interface ProjectSessionSelectionMetadata {
	readonly selectedTrackId?: string | null;
	readonly selectedClipId?: string | null;
	readonly selectedAnnotationId?: string | null;
}

export interface CapturedProjectSessionSelection {
	readonly selectedTrackId: string | null;
	readonly selectedClipId: string | null;
	readonly selectedAnnotationId: string | null;
}

export interface ProjectSessionSelectionServiceDependencies<
	Project extends ProjectSessionSelectionProject,
> {
	readonly state: ProjectSessionSelectionState;
	readonly findTrack: (
		project: Project,
		trackId: string | null | undefined,
	) => Readonly<{ id: string }> | null;
	readonly findClip: (
		project: Project,
		clipId: string | null | undefined,
	) => Readonly<{ id: string }> | null;
}

export function createProjectSessionSelectionService<
	Project extends ProjectSessionSelectionProject,
>(dependencies: ProjectSessionSelectionServiceDependencies<Project>) {
	return Object.freeze({ capture, restore });

	function capture(): Readonly<CapturedProjectSessionSelection> {
		return Object.freeze({
			selectedTrackId: dependencies.state.selectedTrackId,
			selectedClipId: dependencies.state.selectedClipId,
			selectedAnnotationId: dependencies.state.selectedAnnotationId,
		});
	}

	function restore(
		project: Project,
		metadata: Readonly<ProjectSessionSelectionMetadata> = {},
	): void {
		if (dependencies.state.selectedLabels?.length) dependencies.state.selectedLabels = [];
		dependencies.state.selectedTrackId = metadata.selectedTrackId === null ? null
			: dependencies.findTrack(project, metadata.selectedTrackId ?? durableSelectionId(project, 'trackIds',
				(id) => dependencies.findTrack(project, id) !== null))?.id
				?? project.tracks.find((track) => track.type !== 'label')?.id
				?? project.tracks[0]?.id
				?? null;
		dependencies.state.selectedClipId = Object.hasOwn(metadata, 'selectedClipId')
			? dependencies.findClip(project, metadata.selectedClipId)?.id ?? null
			: firstDurableSelectedClipId(project);
		dependencies.state.selectedAnnotationId = existingActiveAnnotationId(project,
			Object.hasOwn(metadata, 'selectedAnnotationId') ? metadata.selectedAnnotationId
				: durableSelectionId(project, 'annotationIds', (id) => existingActiveAnnotationId(project, id) !== null));
	}

	function firstDurableSelectedClipId(project: Project): string | null {
		const selection = project.selection;
		if (selection === null || typeof selection !== 'object' || Array.isArray(selection)) return null;
		const clipIds = (selection as Readonly<{ clipIds?: unknown }>).clipIds;
		if (!Array.isArray(clipIds)) return null;
		for (const clipId of clipIds) {
			if (typeof clipId !== 'string' || !clipId) continue;
			const clip = dependencies.findClip(project, clipId);
			if (clip) return clip.id;
		}
		return null;
	}
}

function durableSelectionId(project: ProjectSessionSelectionProject, key: 'trackIds' | 'annotationIds', exists: (id: string) => boolean): string | null {
	if (!project.selection || typeof project.selection !== 'object' || Array.isArray(project.selection)) return null;
	const ids = (project.selection as Readonly<Record<string, unknown>>)[key];
	return Array.isArray(ids) ? ids.find((id): id is string => typeof id === 'string' && exists(id)) ?? null : null;
}

function existingActiveAnnotationId(
	project: ProjectSessionSelectionProject,
	requestedAnnotationId: unknown,
): string | null {
	if (!isActiveAudioEditorProjectSchema(project)
		|| typeof requestedAnnotationId !== 'string'
		|| !requestedAnnotationId) return null;
	try {
		const annotations = project.timelineAnnotations;
		if (!Array.isArray(annotations)) return null;
		let found = false;
		for (const annotation of annotations) {
			if (annotation === null || typeof annotation !== 'object' || Array.isArray(annotation)) return null;
			const id = Object.getOwnPropertyDescriptor(annotation, 'id');
			if (!id || !('value' in id) || typeof id.value !== 'string' || !id.value) return null;
			if (id.value === requestedAnnotationId) found = true;
		}
		return found ? requestedAnnotationId : null;
	} catch {
		return null;
	}
}
