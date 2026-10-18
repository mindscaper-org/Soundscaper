/* SPDX-License-Identifier: AGPL-3.0-only */

import { chmod, lstat, open, realpath } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { deriveLightscaperNativeCatalogPathsCurrentV1, initializeLightscaperNativeCatalogDatabaseCurrentV1 } from './lightscaper-native-catalog-database-current-v1.ts';

/** The owning Original store has already admitted the shared private directory.
 * Catalog bytes and all SQLite sidecars have a separate fixed identity. */
export async function openLightscaperNativeCatalogDatabaseCurrentV1(appDataPath: string): Promise<DatabaseSync> {
	const paths = deriveLightscaperNativeCatalogPathsCurrentV1(appDataPath);
	for (const suffix of ['', '-wal', '-shm', '-journal']) await admitFile(`${paths.databasePath}${suffix}`, true);
	const database = new DatabaseSync(paths.databasePath, { allowExtension: false, enableDoubleQuotedStringLiterals: false, timeout: 50 });
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database);
		await admitFile(paths.databasePath, false);
		await chmod(paths.databasePath, 0o600);
		database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
		if (process.platform !== 'win32') {
			const directory = await open(paths.libraryRoot, 'r');
			let failure: unknown, failed = false;
			try { await directory.sync(); } catch (error) { failure = error; failed = true; }
			try { await directory.close(); }
			catch (cleanup) { throw new AggregateError(failed ? [failure, cleanup] : [cleanup], 'Native catalog directory retirement failed.', { cause: cleanup }); }
			if (failed) throw failure;
		}
		return database;
	} catch (error) {
		try { database.close(); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native catalog opening and database retirement failed.', { cause: cleanup }); }
		throw error;
	}
}

async function admitFile(path: string, optional: boolean): Promise<void> {
	try {
		const entry = await lstat(path);
		if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || await realpath(path) !== path) {
			throw new TypeError('Native catalog database and sidecars require canonical private regular files.');
		}
	} catch (error) {
		if (optional && error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
		throw error;
	}
}
