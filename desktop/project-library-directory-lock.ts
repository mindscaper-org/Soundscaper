/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';
import { openLocalDesktopDatabase } from './desktop-database.ts';

export class ProjectLibraryDirectoryInUseError extends Error {
	readonly root: string;
	constructor(root: string, cause: unknown) {
		super('The project library is in use. Close the other editor or let its library move finish, then restart.', { cause });
		this.name = 'ProjectLibraryDirectoryInUseError';
		this.root = root;
	}
}

/** This directory stays in place when the v1 library moves. */
export function projectLibraryLocationDirectory(root: string, appName: string): string {
	return join(root, `.${appName.toLowerCase()}-temporary-library`);
}

/** A connection holds an OS-managed SQLite lock without writing catalog data. */
export function openProjectLibraryDirectoryLock(root: string, appName: string, mode: 'open' | 'move'): () => void {
	const path = join(projectLibraryLocationDirectory(root, appName), 'directory-lock.sqlite3');
	const database = openLocalDesktopDatabase(path, { timeout: 0 });
	try {
		if (mode === 'move') database.exec('BEGIN EXCLUSIVE');
		else {
			database.exec('BEGIN');
			database.prepare('SELECT name FROM sqlite_schema LIMIT 1').get();
		}
		return () => { if (database.isOpen) database.close(); };
	} catch (error) {
		database.close();
		const code = (error as { errcode?: unknown })?.errcode;
		if (typeof code === 'number' && [5, 6].includes(code & 0xff)) throw new ProjectLibraryDirectoryInUseError(root, error);
		throw error;
	}
}

export async function withProjectLibraryRelocation<Result>(
	roots: readonly [string, string], appName: string, move: () => Promise<Result>,
): Promise<Result> {
	const [first, second] = roots[0] <= roots[1] ? roots : [roots[1], roots[0]] as const;
	const closeFirst = openProjectLibraryDirectoryLock(first, appName, 'move');
	try {
		const closeSecond = first === second ? undefined : openProjectLibraryDirectoryLock(second, appName, 'move');
		try { return await move(); } finally { closeSecond?.(); }
	} finally { closeFirst(); }
}
