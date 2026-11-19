/* SPDX-License-Identifier: AGPL-3.0-only */
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const PREPARE = DatabaseSync.prototype.prepare;
interface Namespace { readonly owners: Set<object>; failure?: unknown; failed: boolean }
const namespaces = new Map<string, Namespace>(), QUARANTINE = new Set<object>();
const known = new WeakMap<DatabaseSync, string>();
/** Same-process bounded ownership. Production Scopes retains the actual
 * appData-wide cross-process SQLite writer guard through these owners. */
export function lightscaperNativePhotoUploadNamespaceCurrentV1(database: DatabaseSync) {
	const row = Reflect.apply(PREPARE, database, ['PRAGMA database_list']).get();
	if (database.isTransaction || row?.name !== 'main' || typeof row.file !== 'string' || !row.file
		|| basename(row.file) !== 'native-photo-originals.sqlite3') throw new Error('Native upload requires its idle actual media namespace.');
	const path = realpathSync.native(row.file);
	if (path !== row.file || Reflect.apply(PREPARE, database, ['PRAGMA application_id']).get()?.application_id !== 0x4c534350
		|| Reflect.apply(PREPARE, database, ['PRAGMA user_version']).get()?.user_version !== 4) throw new Error('Native upload namespace identity is unowned.');
	const key = process.platform === 'win32' ? path.toLowerCase() : path; known.set(database, key);
	let state = namespaces.get(key);
	const current = (): void => { const selected = namespaces.get(key); if (selected?.failed) throw selected.failure; };
	return Object.freeze({ path, stagingRoot: join(dirname(path), 'native-photo-originals-staging'), assertCurrent: current,
		register(owner: object): Readonly<{ release(): void; quarantine(error: unknown): void }> {
			current(); if (!state) { state = { owners: new Set(), failed: false }; namespaces.set(key, state); }
			if (state.owners.size >= 16) throw new RangeError('Native upload capacity is busy.');
			const selected = state; selected.owners.add(owner); let retired = false;
			return Object.freeze({ release(): void {
				if (retired || selected.failed) return; retired = true; selected.owners.delete(owner);
				if (!selected.owners.size && namespaces.get(key) === selected) namespaces.delete(key);
			}, quarantine(error: unknown): void { selected.failed = true; selected.failure = error; QUARANTINE.add(owner); } });
		},
	});
}
export function assertLightscaperNativePhotoUploadFilesCurrentV1(database: DatabaseSync): void {
	const key = known.get(database);
	if (key !== undefined) { const selected = namespaces.get(key); if (selected?.failed) throw selected.failure; return; }
	lightscaperNativePhotoUploadNamespaceCurrentV1(database).assertCurrent();
}
