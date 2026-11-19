/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const SESSION_SNAPSHOT_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze({
	title: 'Session snapshots',
	purpose: 'Keep named editing states that share the project’s audio. Restore an earlier arrangement or mix without copying the media.',
	instructions: 'Snapshots share the same audio files and are saved inside this project. Restore changes the current edit and can be undone.',
	name: 'Snapshot name',
	create: 'Create snapshot',
	list: 'Saved snapshots',
	empty: 'No snapshots yet.',
	restore: 'Restore snapshot',
	rename: 'Rename snapshot',
	remove: 'Delete snapshot',
	close: 'Done',
}) });

export function resolveSessionSnapshotCopy(copy: Readonly<Record<string, string>>) {
	return resolveEditorCopyScope('sessionSnapshots', SESSION_SNAPSHOT_COPY_BY_LOCALE.en, copy);
}
