/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TrackListRowPlan, TrackFolderRowUiModel } from './track-folder-ui-model.ts';

interface NavigationIndex {
	readonly byId: ReadonlyMap<string, TrackFolderRowUiModel>;
	readonly visible: readonly TrackFolderRowUiModel[];
	readonly position: ReadonlyMap<string, number>;
	readonly firstChild: ReadonlyMap<string, TrackFolderRowUiModel>;
}
const indexes = new WeakMap<TrackListRowPlan, NavigationIndex>();

/** Frozen plans are made by planTrackListRows; mutable callers are read afresh. */
export function trackFolderNavigationIndex(plan: TrackListRowPlan): NavigationIndex {
	const previous = indexes.get(plan);
	if (previous) return previous;
	const byId = new Map<string, TrackFolderRowUiModel>();
	const visible: TrackFolderRowUiModel[] = [];
	const position = new Map<string, number>();
	const firstChild = new Map<string, TrackFolderRowUiModel>();
	for (const row of plan.folderRows) {
		const id = row.id;
		if (!byId.has(id)) byId.set(id, row);
		if (row.rowHidden) continue;
		if (!position.has(id)) position.set(id, visible.length);
		visible.push(row);
		if (row.parentFolderId !== null && !firstChild.has(row.parentFolderId)) firstChild.set(row.parentFolderId, row);
	}
	const index = { byId, visible, position, firstChild };
	if (Object.isFrozen(plan) && Object.isFrozen(plan.folderRows) && plan.folderRows.every(Object.isFrozen)) indexes.set(plan, index);
	return index;
}
