/* SPDX-License-Identifier: AGPL-3.0-only */

export const SESSION_SNAPSHOT_COMMAND_TYPES = [
	'project/snapshot-create', 'project/snapshot-restore', 'project/snapshot-rename', 'project/snapshot-remove',
] as const;

export interface SessionSnapshotCommandPayloads {
	readonly 'project/snapshot-create': { readonly id: string; readonly name: string; readonly createdAt: string };
	readonly 'project/snapshot-restore': { readonly id: string };
	readonly 'project/snapshot-rename': { readonly id: string; readonly name: string };
	readonly 'project/snapshot-remove': { readonly id: string };
}

export type SessionSnapshotCommand = { [Key in keyof SessionSnapshotCommandPayloads]:
	Readonly<{ type: Key }> & SessionSnapshotCommandPayloads[Key]
}[keyof SessionSnapshotCommandPayloads];
