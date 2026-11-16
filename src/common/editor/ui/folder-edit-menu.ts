/* SPDX-License-Identifier: AGPL-3.0-only */

import { folderContentTarget, type FolderContentProject } from '../folder-content-editing.ts';

const COMMANDS = [
	['folder-select', 'selectFolderContents', 'folderSelect'],
	['folder-split', 'splitFolderContents', 'folderSplit'],
	['folder-delete', 'deleteFolderContents', 'folderDelete'],
	['folder-ripple-cut', 'rippleCutFolderContents', 'folderRippleCut'],
	['folder-ripple-delete', 'rippleDeleteFolderContents', 'folderRippleDelete'],
	['folder-ripple-insert', 'rippleInsertFolderContents', 'folderRippleInsert'],
] as const;

interface FolderMenuOptions {
	readonly project: FolderContentProject & Readonly<{ selection?: Readonly<{ startFrame: number; endFrame: number }> | null }>;
	readonly folderId: string | null;
	readonly copy: Readonly<Record<string, string>>;
	readonly blocked: boolean;
	readonly hasClipboard: boolean;
}

/** The same menu commands serve collapsed rows, the application menu and shortcut preferences. */
export function createFolderEditMenu(options: FolderMenuOptions, execute: (id: string, method: string) => unknown) {
	let trackIds: readonly string[] = [];
	try { if (options.folderId) trackIds = folderContentTarget(options.project, options.folderId).trackIds; }
	catch { /* A removed folder leaves a disabled menu until the next presentation. */ }
	const hasRange = Boolean(options.project.selection && options.project.selection.endFrame > options.project.selection.startFrame);
	const locked = options.project.tracks.some(track => trackIds.includes(track.id) && track.locked);
	return {
		id: 'folder-content-edits', label: options.copy.editFolderContents, tooltipKey: 'editFolderContents',
		onClick: undefined,
		items: COMMANDS.map(([id, key, method]) => ({
			id, label: options.copy[key], tooltipKey: key,
			disabled: options.blocked || !trackIds.length || (id !== 'folder-select' && locked)
				|| (['folder-delete', 'folder-ripple-cut', 'folder-ripple-delete'].includes(id) && !hasRange)
				|| (id === 'folder-ripple-insert' && !options.hasClipboard),
			onClick: () => execute(id, method),
		})),
	};
}
