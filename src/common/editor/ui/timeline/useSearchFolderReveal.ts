/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { DocumentTrackFolderSnapshot } from '../../controller/document/document-track-folder-snapshot.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';

interface SearchReveal {
	readonly clipId?: string;
	readonly projectIdentity?: string;
}

/** Reveal a searched recording without saving a folder edit or changing audibility. */
export function useSearchFolderReveal(
	project: Readonly<{ id?: string; tracks: readonly Readonly<{ id: string; clipIds?: readonly string[] }>[] }>,
	controller: unknown,
	request: SearchReveal | null | undefined,
	folders: DocumentTrackFolderSnapshot | null | undefined,
	setOverrides: Dispatch<SetStateAction<Map<string, boolean>>>,
): void {
	const consumed = useRef<SearchReveal | null>(null);
	const projectIdentity = editorProjectEditSessionKey(controller, project.id);
	useLayoutEffect(() => {
		if (!request || consumed.current === request || request.projectIdentity !== projectIdentity) return;
		consumed.current = request;
		const track = project.tracks.find(candidate => candidate.clipIds?.includes(request.clipId ?? ''));
		if (!track) return;
		const row = folders?.sequences.flatMap(sequence => sequence.rows)
			.find(candidate => candidate.kind === 'track' && candidate.id === track.id);
		if (!row?.ancestorFolderIds.length) return;
		setOverrides(current => {
			const next = new Map(current);
			for (const folderId of row.ancestorFolderIds) next.set(folderId, false);
			return next;
		});
	}, [controller, folders, project, projectIdentity, request, setOverrides]);
}
