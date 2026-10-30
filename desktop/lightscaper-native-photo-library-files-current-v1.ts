/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';

export interface LightscaperNativePhotoLibraryDatabaseProfileCurrentV1 {
	readonly fileName: 'native-photo-library-writer.sqlite3' | 'native-photo-library-scopes.sqlite3' | 'native-photo-catalogs.sqlite3' | 'native-photo-preview-cache.sqlite3';
	readonly inspect: (database: DatabaseSync) => 'empty' | 'owned' | 1 | 2 | 3 | 4 | 5;
	readonly initialize: (database: DatabaseSync) => void;
}
const NAMES: readonly string[] = ['native-photo-library-writer.sqlite3', 'native-photo-library-scopes.sqlite3', 'native-photo-catalogs.sqlite3', 'native-photo-preview-cache.sqlite3'];
const SIDECARS = ['', '-wal', '-shm', '-journal'] as const;

/** Trusted fixed main-private profiles share secure admission. This creates no
 * body directories and grants no namespace, reader or deletion authority. The
 * caller joins all connection users before close. Existing files are inspected
 * read-only before writable recovery, chmod or journaling changes. */
export async function openLightscaperNativePhotoLibraryDatabaseCurrentV1(appDataPath: string,
	value: Readonly<LightscaperNativePhotoLibraryDatabaseProfileCurrentV1>): Promise<DatabaseSync> {
	const profile = capture(value);
	if (typeof appDataPath !== 'string' || !isAbsolute(appDataPath) || resolve(appDataPath) !== appDataPath || appDataPath.includes('\0')) {
		throw new TypeError('Native Photo library appData requires a canonical absolute directory.');
	}
	await directory(appDataPath, false);
	const parents = [join(appDataPath, 'Lightscaper'), join(appDataPath, 'Lightscaper', 'project-library'), join(appDataPath, 'Lightscaper', 'project-library', 'v1')];
	for (const path of parents) await directory(path, true);
	const path = join(parents[2]!, profile.fileName), existing = await files(path);
	if (!existing[0] && existing.slice(1).some(Boolean)) throw new Error('Native Photo library sidecars have no primary database authority.');
	if (!existing[0]) await createDatabaseFile(path);
	for (const parent of parents) await directory(parent, false);
	await files(path); await file(path, false);
	preflight(path, profile);
	const database = new DatabaseSync(path, { allowExtension: false, enableDoubleQuotedStringLiterals: false, timeout: 50 });
	try {
		database.exec('PRAGMA foreign_keys=ON');
		if (database.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) throw new Error('Native library foreign-key enforcement was not admitted.');
		Reflect.apply(profile.initialize, undefined, [database]);
		Reflect.apply(profile.inspect, undefined, [database]);
		for (const parent of parents) { await directory(parent, false); await chmod(parent, 0o700); }
		await privateFiles(path);
		database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
		if (database.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal'
			|| database.prepare('PRAGMA synchronous').get()?.synchronous !== 2) throw new Error('Native library SQLite durability policy was not admitted.');
		await privateFiles(path); await syncDirectory(parents[2]!); return database;
	} catch (primary) {
		try { database.close(); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native library opening and database retirement failed.', { cause: cleanup }); }
		throw primary;
	}
}

function capture(value: Readonly<LightscaperNativePhotoLibraryDatabaseProfileCurrentV1>): Readonly<LightscaperNativePhotoLibraryDatabaseProfileCurrentV1> {
	const input = record(value, 'native library database profile', ['fileName', 'inspect', 'initialize']);
	const fileName = field(input, 'fileName', 'native library database profile'), inspect = field(input, 'inspect', 'native library database profile');
	const initialize = field(input, 'initialize', 'native library database profile');
	if (typeof fileName !== 'string' || !NAMES.includes(fileName) || typeof inspect !== 'function' || typeof initialize !== 'function') throw new TypeError('Native library requires one of its exact trusted database profiles.');
	return Object.freeze({ fileName, inspect, initialize }) as Readonly<LightscaperNativePhotoLibraryDatabaseProfileCurrentV1>;
}
function preflight(path: string, profile: Readonly<LightscaperNativePhotoLibraryDatabaseProfileCurrentV1>): void {
	const database = new DatabaseSync(path, { readOnly: true, allowExtension: false, enableDoubleQuotedStringLiterals: false, timeout: 50 });
	let failed = false, primary: unknown; const cleanup: unknown[] = [];
	try { database.exec('BEGIN'); Reflect.apply(profile.inspect, undefined, [database]); database.exec('COMMIT'); }
	catch (error) {
		failed = true; primary = error;
		try { if (database.isTransaction) database.exec('ROLLBACK'); } catch (error) { cleanup.push(error); }
	}
	try { database.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native library read-only preflight retirement failed.', { cause: cleanup[0] });
	if (failed) throw primary;
}
async function files(path: string): Promise<readonly boolean[]> {
	const result: boolean[] = []; for (const suffix of SIDECARS) result.push(await file(path + suffix, true)); return result;
}
async function privateFiles(path: string): Promise<void> {
	await file(path, false);
	for (const suffix of SIDECARS) if (await file(path + suffix, true)) await chmod(path + suffix, 0o600);
}
async function file(path: string, optional: boolean): Promise<boolean> {
	try {
		const entry = await lstat(path);
		if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || await realpath(path) !== path) throw new TypeError('Native library databases and sidecars require canonical single-link regular files.');
		return true;
	} catch (error) { if (optional && hasCode(error, 'ENOENT')) return false; throw error; }
}
async function directory(path: string, create: boolean): Promise<void> {
	let created = false;
	if (create) { try { await mkdir(path, { mode: 0o700 }); created = true; } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; } }
	const entry = await lstat(path);
	if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path) throw new TypeError('Native library storage requires canonical real directories.');
	if (created) await chmod(path, 0o700); if (create) await syncDirectory(dirname(path));
}
async function createDatabaseFile(path: string): Promise<void> {
	let handle: FileHandle;
	try { handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600); }
	catch (error) { if (hasCode(error, 'EEXIST')) { await file(path, false); return; } throw error; }
	await withHandle(handle, () => handle.sync()); await syncDirectory(dirname(path));
}
async function syncDirectory(path: string): Promise<void> {
	// Byte fsync/SQLite FULL remain required on Windows; portable directory
	// FlushFileBuffers or power-loss qualification is not claimed here.
	if (process.platform === 'win32') return;
	const handle = await open(path, constants.O_RDONLY); await withHandle(handle, () => handle.sync());
}
async function withHandle(handle: FileHandle, run: () => Promise<void>): Promise<void> {
	let failed = false, primary: unknown;
	try { await run(); } catch (error) { failed = true; primary = error; }
	try { await handle.close(); }
	catch (cleanup) { throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Native library file retirement failed.', { cause: cleanup }); }
	if (failed) throw primary;
}
function hasCode(error: unknown, code: string): boolean { return error !== null && typeof error === 'object' && 'code' in error && error.code === code; }
