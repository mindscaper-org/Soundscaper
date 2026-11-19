/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat, realpath } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
export interface LinkedGrantNamespaceCurrentV1 { readonly path: string; readonly device: string; readonly inode: string }
const key = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path;
export async function captureLinkedGrantNamespaceCurrentV1(mediaDatabasePath: string): Promise<Readonly<LinkedGrantNamespaceCurrentV1>> {
	const actual = await realpath(mediaDatabasePath), info = await lstat(mediaDatabasePath, { bigint: true });
	if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.dev < 0n || info.ino < 0n || key(actual) !== key(mediaDatabasePath)) throw new Error('Native grant namespace requires the actual canonical media database identity.');
	return Object.freeze({ path: actual, device: info.dev.toString(), inode: info.ino.toString() });
}
export function assertLinkedGrantNamespaceCurrentV1(expected: LinkedGrantNamespaceCurrentV1, actual: LinkedGrantNamespaceCurrentV1): void {
	if (key(expected.path) !== key(actual.path) || expected.device !== actual.device || expected.inode !== actual.inode) throw new Error('Native grant namespace binding differs from its selected allocation identity.');
}
export function readLinkedGrantNamespaceCurrentV1(db: DatabaseSync, expected: LinkedGrantNamespaceCurrentV1): void {
	const rows = db.prepare(`SELECT singleton,
		CASE WHEN typeof(media_path)='text' AND length(CAST(media_path AS BLOB)) BETWEEN 1 AND 262144 THEN media_path END AS media_path,
		CASE WHEN typeof(media_device)='text' AND length(CAST(media_device AS BLOB)) BETWEEN 1 AND 256 THEN media_device END AS media_device,
		CASE WHEN typeof(media_inode)='text' AND length(CAST(media_inode AS BLOB)) BETWEEN 1 AND 256 THEN media_inode END AS media_inode
		FROM native_photo_linked_grant_owner LIMIT 2`).all();
	const row = rows[0]; if (rows.length !== 1 || row?.singleton !== 1 || typeof row.media_path !== 'string') throw new Error('Native grant namespace binding is missing or invalid.');
	const path: unknown = JSON.parse(row.media_path);
	if (typeof path !== 'string' || JSON.stringify(path) !== row.media_path || typeof row.media_device !== 'string' || typeof row.media_inode !== 'string'
		|| !/^(?:0|[1-9][0-9]{0,255})$/u.test(row.media_device) || !/^(?:0|[1-9][0-9]{0,255})$/u.test(row.media_inode)) throw new Error('Native grant namespace identity is not canonical.');
	assertLinkedGrantNamespaceCurrentV1(expected, { path, device: row.media_device, inode: row.media_inode });
}
