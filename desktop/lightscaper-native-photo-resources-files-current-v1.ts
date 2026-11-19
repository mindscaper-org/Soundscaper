/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deriveLightscaperNativePhotoResourcePathsCurrentV1, initializeLightscaperNativePhotoResourceDatabaseCurrentV1, inspectLightscaperNativePhotoResourceDatabaseCurrentV1 } from './lightscaper-native-photo-resources-database-current-v1.ts';

const SIDECARS = ['', '-wal', '-shm', '-journal'] as const;

/** Standalone native resource admission creates only the fixed product scope;
 * Original body/index preparation and renderer paths provide no authority.
 * The caller owns the returned real connection and joins work before close. */
export async function openLightscaperNativePhotoResourceDatabaseCurrentV1(appDataPath: string): Promise<DatabaseSync> {
	const paths = deriveLightscaperNativePhotoResourcePathsCurrentV1(appDataPath);
	await directory(appDataPath, false);
	const parents = [join(appDataPath, 'Lightscaper'), join(appDataPath, 'Lightscaper', 'project-library'), paths.libraryRoot];
	for (const path of parents) await directory(path, true);
	const existed = await files(paths.databasePath);
	if (!existed[0] && existed.slice(1).some(Boolean)) throw new Error('Native resource sidecars have no primary database authority.');
	const created = !existed[0] && await createDatabaseFile(paths.databasePath);
	for (const path of parents) await directory(path, false);
	await files(paths.databasePath);
	await file(paths.databasePath, false);
	if (!created) preflight(paths.databasePath);
	const database = new DatabaseSync(paths.databasePath, { allowExtension: false, enableDoubleQuotedStringLiterals: false, timeout: 50 });
	try {
		// No chmod or WAL transition may adopt a foreign database. Exact schema
		// ownership is settled before permissions or journaling can change.
		initializeLightscaperNativePhotoResourceDatabaseCurrentV1(database);
		for (const path of parents) await directory(path, false);
		await privateFiles(paths.databasePath);
		database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
		if (database.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal'
			|| database.prepare('PRAGMA synchronous').get()?.synchronous !== 2) throw new Error('Native resource SQLite durability policy was not admitted.');
		await privateFiles(paths.databasePath); await syncDirectory(paths.libraryRoot);
		return database;
	} catch (error) {
		try { database.close(); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native resource opening and database retirement failed.', { cause: cleanup }); }
		throw error;
	}
}
async function files(path: string): Promise<readonly boolean[]> {
	const result: boolean[] = [];
	for (const suffix of SIDECARS) result.push(await file(path + suffix, true));
	return result;
}
async function privateFiles(path: string): Promise<void> {
	await file(path, false);
	for (const suffix of SIDECARS) if (await file(path + suffix, true)) await chmod(path + suffix, 0o600);
}
async function file(path: string, optional: boolean): Promise<boolean> {
	try {
		const entry = await lstat(path);
		if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || await realpath(path) !== path) {
			throw new TypeError('Native resource database and sidecars require canonical single-link regular files.');
		}
		return true;
	} catch (error) { if (optional && hasCode(error, 'ENOENT')) return false; throw error; }
}
async function directory(path: string, create: boolean): Promise<void> {
	if (create) { try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; } }
	const entry = await lstat(path);
	if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path) throw new TypeError('Native resource storage requires canonical real directories.');
	if (create) { await chmod(path, 0o700); await syncDirectory(dirname(path)); }
}
function preflight(path: string): void {
	const database = new DatabaseSync(path, { readOnly: true, allowExtension: false, enableDoubleQuotedStringLiterals: false, timeout: 50 });
	let failed = false, primary: unknown; const cleanup: unknown[] = [];
	try { database.exec('BEGIN'); inspectLightscaperNativePhotoResourceDatabaseCurrentV1(database); database.exec('COMMIT'); }
	catch (error) {
		failed = true; primary = error;
		try { if (database.isTransaction) database.exec('ROLLBACK'); } catch (error) { cleanup.push(error); }
	}
	try { database.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError(failed ? [primary, ...cleanup] : cleanup, 'Native resource read-only preflight retirement failed.', { cause: cleanup[0] });
	if (failed) throw primary;
}
async function createDatabaseFile(path: string): Promise<boolean> {
	let handle: FileHandle;
	try { handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600); }
	catch (error) { if (hasCode(error, 'EEXIST')) { await file(path, false); return false; } throw error; }
	await withHandle(handle, () => handle.sync());
	return true;
}
async function syncDirectory(path: string): Promise<void> {
	// Native byte fsync and SQLite FULL still apply on Windows; portable
	// directory FlushFileBuffers/power-loss qualification is not claimed.
	if (process.platform === 'win32') return;
	const handle = await open(path, constants.O_RDONLY); await withHandle(handle, () => handle.sync());
}
async function withHandle(handle: FileHandle, run: () => Promise<void>): Promise<void> {
	let failure: unknown, failed = false;
	try { await run(); } catch (error) { failure = error; failed = true; }
	try { await handle.close(); }
	catch (cleanup) { throw new AggregateError(failed ? [failure, cleanup] : [cleanup], 'Native resource file retirement failed.', { cause: cleanup }); }
	if (failed) throw failure;
}
function hasCode(error: unknown, code: string): boolean {
	return error !== null && typeof error === 'object' && 'code' in error && error.code === code;
}
