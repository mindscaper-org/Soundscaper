/* SPDX-License-Identifier: AGPL-3.0-only */

import { mediaClipOwnerIndex } from '../../../commands/clip-edit-index.ts';
import type { SelectionViewProject, SelectionViewSelectionCommand, SelectionViewTrack } from './selection-view-service-types.d.ts';

/** The controller publishes a fresh project for media edits; selection commands retain ownership. */
export function createSelectionOwnershipIndex<Project extends SelectionViewProject>(
	getProject: () => Project | null,
	updateSelection: (command: SelectionViewSelectionCommand) => Project,
) {
	const indexes = new WeakMap<Project, ReadonlyMap<string, SelectionViewTrack>>();
	return {
		get(project: Project): ReadonlyMap<string, SelectionViewTrack> {
			let owners = indexes.get(project);
			if (!owners) { owners = mediaClipOwnerIndex(project.tracks); indexes.set(project, owners); }
			return owners;
		},
		updateSelection(command: SelectionViewSelectionCommand): Project {
			const before = getProject();
			const owners = before ? indexes.get(before) : undefined;
			const after = updateSelection(command);
			if (owners) indexes.set(after, owners);
			return after;
		},
	};
}
