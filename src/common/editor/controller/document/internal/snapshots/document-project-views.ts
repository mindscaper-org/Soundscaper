/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDocumentMasteringSequenceSnapshot } from '../../document-mastering-sequence-snapshot.ts';
import { createDocumentTrackFolderSnapshot } from '../../document-track-folder-snapshot.ts';
import { createDocumentTimelineAnnotationSnapshot } from './document-timeline-annotation-snapshot.ts';

interface ProjectSnapshotTracks {
	readonly tracks?: readonly Readonly<{ id: string; type?: string; displayMode?: string }>[];
}

interface DocumentProjectViews {
	readonly timelineAnnotations: ReturnType<typeof createDocumentTimelineAnnotationSnapshot>;
	readonly masteringSequences: ReturnType<typeof createDocumentMasteringSequenceSnapshot>;
	readonly trackFolders: ReturnType<typeof createDocumentTrackFolderSnapshot>;
	readonly spectralDisplay: 'spectrogram' | 'multiview' | null;
}

const VIEWS = new WeakMap<object, DocumentProjectViews>();
const EMPTY = derive(null);

/** The publisher's detached project identity owns these immutable document views. */
export function documentProjectViews(project: ProjectSnapshotTracks | null, publishedProject: object | null): DocumentProjectViews {
	if (!publishedProject) return EMPTY;
	const cached = VIEWS.get(publishedProject);
	if (cached) return cached;
	const views = derive(project);
	VIEWS.set(publishedProject, views);
	return views;
}

function derive(project: ProjectSnapshotTracks | null): DocumentProjectViews {
	return Object.freeze({
		timelineAnnotations: createDocumentTimelineAnnotationSnapshot(project),
		masteringSequences: createDocumentMasteringSequenceSnapshot(project),
		trackFolders: createDocumentTrackFolderSnapshot(project),
		spectralDisplay: unanimousSpectralDisplay(project?.tracks ?? []),
	});
}

function unanimousSpectralDisplay(tracks: NonNullable<ProjectSnapshotTracks['tracks']>): DocumentProjectViews['spectralDisplay'] {
	let uniform: DocumentProjectViews['spectralDisplay'] = null;
	for (const { type, displayMode } of tracks) {
		if (type !== 'audio') continue;
		if (displayMode !== 'spectrogram' && displayMode !== 'multiview') return null;
		if (uniform !== null && displayMode !== uniform) return null;
		uniform = displayMode;
	}
	return uniform;
}
