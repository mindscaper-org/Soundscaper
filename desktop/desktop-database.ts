/* SPDX-License-Identifier: AGPL-3.0-only */

import { DatabaseSync, type DatabaseSyncOptions } from 'node:sqlite';
import { lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { assertLocalDesktopStorage } from './local-storage-safety.ts';

/** Inspect sidecars before SQLite can read/replay them, including on a missing main file. */
export function openLocalDesktopDatabase(path: string, options: DatabaseSyncOptions = {}): DatabaseSync {
	if (path === ':memory:') return new DatabaseSync(path, options);
	assertLocalDesktopStorage(path);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	assertLocalDesktopStorage(path);
	try {
		const entry = lstatSync(path);
		if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink > 1) {
			throw new Error('Working database must be a regular file with a single filesystem name.');
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	for (const suffix of ['-wal', '-shm']) {
		try { lstatSync(`${path}${suffix}`); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
			throw error;
		}
		throw new Error(`A database WAL sidecar needs recovery review before opening: ${path}. `
			+ 'Keep the database and its -wal/-shm files together and unchanged; do not delete the sidecars. '
			+ 'They may contain interrupted work or an older copy restored by sync.');
	}
	return new DatabaseSync(path, {
		allowExtension: false, enableDoubleQuotedStringLiterals: false,
		enableForeignKeyConstraints: true, ...options,
	});
}

/** Rollback journaling eliminates new WAL sidecars; FULL retains synchronous commits. */
export function configureDesktopDatabaseJournal(database: DatabaseSync): void {
	const current = database.prepare('PRAGMA journal_mode').get()?.journal_mode;
	if (current !== 'delete' && current !== 'memory') {
		const mode = database.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode;
		if (mode !== 'delete') throw new Error('Working database could not enable rollback journaling.');
	}
	database.exec('PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON;');
}
