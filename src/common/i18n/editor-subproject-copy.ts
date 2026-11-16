/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const SUBPROJECT_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze({
	title: 'Subprojects',
	instructions: 'Insert an editable project as audio. Saved changes update automatically. Clips keep their published length, position, trims and fades.',
	portable: 'Portable copies include the rendered audio. To edit a child on another computer, transfer that project separately and relink it here.',
	candidate: 'Project to insert or relink',
	choose: 'Choose a project',
	insert: 'Insert subproject',
	list: 'Linked subprojects',
	empty: 'No linked subprojects.',
	open: 'Open subproject',
	refresh: 'Refresh audio',
	follow: 'Follow saved changes',
	pin: 'Pin current audio',
	detach: 'Make independent audio',
	relink: 'Relink to selected project',
	automatic: 'Automatic updates',
	relinkRequired: 'Relink required',
	pinned: 'Pinned audio',
	close: 'Close',
}) });

export function resolveSubprojectCopy(copy: Readonly<Record<string, string>>) {
	return resolveEditorCopyScope('subprojects', SUBPROJECT_COPY_BY_LOCALE.en, copy);
}
