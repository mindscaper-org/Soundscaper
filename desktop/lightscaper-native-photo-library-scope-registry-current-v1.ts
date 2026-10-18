/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { normalizePhotoLibraryRestoreAllocationV1, type PhotoLibraryRestoreAllocationV1 as Allocation } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { openLightscaperNativePhotoLibraryDatabaseCurrentV1 } from './lightscaper-native-photo-library-files-current-v1.ts';
import { initializeLightscaperNativePhotoLibraryScopeDatabaseCurrentV1, inspectLightscaperNativePhotoLibraryScopeDatabaseCurrentV1,
	readLightscaperNativePhotoLibraryRootOwnerCurrentV1 } from './lightscaper-native-photo-library-scope-schema-current-v1.ts';
import { createLightscaperNativePhotoLibraryGenerationCurrentV1, resumeLightscaperNativePhotoLibraryGenerationCurrentV1,
	lightscaperNativePhotoLibraryManifestCurrentV1 } from './lightscaper-native-photo-library-generation-current-v1.ts';

export interface LightscaperNativePhotoLibraryGenerationCurrentV1 { readonly allocation: Readonly<Allocation>; readonly appDataPath: string }
export interface LightscaperNativePhotoLibraryAllocationPageCurrentV1 {
	readonly allocations: readonly Readonly<{ allocation: Readonly<Allocation>; state: 'reserved' | 'created' }>[]; readonly afterToken: string | null;
}
type Row = Readonly<{ allocation: Readonly<Allocation>; sha256: string; state: 'reserved' | 'created' }>;
const CHECK = AbortSignal.prototype.throwIfAborted, COLUMNS = 'namespace_token,allocation,manifest_sha256,state';

/** Main-private component. Root holds the appData-wide native writer guard
 * before opening this owner and until every returned component scope joins.
 * Reservations/manifest identity grant no selection, restore-ready or deletion. */
export class LightscaperNativePhotoLibraryScopeRegistryCurrentV1 {
	readonly #database: DatabaseSync;
	readonly #owner: string;
	readonly #libraryRoot: string;
	#tail: Promise<void> = Promise.resolve();
	#closing: Promise<void> | null = null;
	private constructor(database: DatabaseSync, libraryRoot: string) {
		this.#database = database; this.#owner = readLightscaperNativePhotoLibraryRootOwnerCurrentV1(database); this.#libraryRoot = libraryRoot;
	}
	static async open(appDataPath: string): Promise<LightscaperNativePhotoLibraryScopeRegistryCurrentV1> {
		const database = await openLightscaperNativePhotoLibraryDatabaseCurrentV1(appDataPath, { fileName: 'native-photo-library-scopes.sqlite3',
			inspect: inspectLightscaperNativePhotoLibraryScopeDatabaseCurrentV1, initialize: initializeLightscaperNativePhotoLibraryScopeDatabaseCurrentV1 });
		try { return new LightscaperNativePhotoLibraryScopeRegistryCurrentV1(database, join(appDataPath, 'Lightscaper', 'project-library', 'v1')); }
		catch (primary) { try { database.close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native registry opening and retirement failed.', { cause: cleanup }); } throw primary; }
	}
	allocate(value: unknown, signal?: AbortSignal): Promise<Readonly<LightscaperNativePhotoLibraryGenerationCurrentV1>> {
		return this.#request(() => normalizePhotoLibraryRestoreAllocationV1(value), signal, async allocation => {
			const manifest = lightscaperNativePhotoLibraryManifestCurrentV1(this.#owner, allocation);
			this.#transaction(true, signal, () => {
				this.#database.prepare(`INSERT INTO native_photo_library_scopes(${COLUMNS}) VALUES(?,?,?,'reserved')`)
					.run(allocation.namespaceToken, JSON.stringify(allocation), manifest.sha256);
				const row = this.#row(allocation.namespaceToken); if (!row || row.state !== 'reserved' || JSON.stringify(row.allocation) !== JSON.stringify(allocation)) throw new Error('Native library reservation was not published exactly.');
			});
			check(signal); const appDataPath = await createLightscaperNativePhotoLibraryGenerationCurrentV1(this.#libraryRoot, this.#owner, allocation, signal);
			this.#created(allocation, manifest.sha256, signal); return Object.freeze({ allocation, appDataPath });
		});
	}
	resume(value: unknown, signal?: AbortSignal): Promise<Readonly<LightscaperNativePhotoLibraryGenerationCurrentV1>> {
		return this.#request(() => token(value), signal, async namespace => {
			const row = this.#transaction(false, signal, () => this.#row(namespace));
			if (!row) throw new ReferenceError('Native library allocation has no durable registry reservation.');
			const appDataPath = await resumeLightscaperNativePhotoLibraryGenerationCurrentV1(this.#libraryRoot, this.#owner, row.allocation, row.state, signal);
			if (row.state === 'reserved') this.#created(row.allocation, row.sha256, signal); else check(signal);
			return Object.freeze({ allocation: row.allocation, appDataPath });
		});
	}
	readPage(afterToken: unknown = null, signal?: AbortSignal): Promise<Readonly<LightscaperNativePhotoLibraryAllocationPageCurrentV1>> {
		return this.#request(() => afterToken === null ? null : token(afterToken), signal, after => this.#transaction(false, signal, () => {
			const rows = this.#database.prepare(`SELECT ${COLUMNS} FROM native_photo_library_scopes${after === null ? '' : ' WHERE namespace_token>?'} ORDER BY namespace_token LIMIT 64`).all(...(after === null ? [] : [after]));
			const allocations = rows.map(raw => { check(signal); const row = this.#readRow(raw); return Object.freeze({ allocation: row.allocation, state: row.state }); });
			return Object.freeze({ allocations: Object.freeze(allocations), afterToken: allocations.length === 64 ? allocations.at(-1)?.allocation.namespaceToken ?? null : null });
		}));
	}
	close(): Promise<void> { this.#closing ??= this.#tail.then(() => { this.#database.close(); }); return this.#closing; }
	#created(allocation: Readonly<Allocation>, manifestSha256: string, signal?: AbortSignal): void {
		this.#transaction(true, signal, () => {
			const row = this.#row(allocation.namespaceToken);
			if (!row || row.state !== 'reserved' || row.sha256 !== manifestSha256 || JSON.stringify(row.allocation) !== JSON.stringify(allocation)) {
				throw new Error('Native library reservation changed from the allocation or manifest that completed filesystem creation.');
			}
			const changed = this.#database.prepare("UPDATE native_photo_library_scopes SET state='created' WHERE namespace_token=? AND state='reserved' AND manifest_sha256=?").run(allocation.namespaceToken, manifestSha256);
			const stored = this.#row(allocation.namespaceToken); if (changed.changes !== 1 || !stored || stored.state !== 'created' || stored.sha256 !== manifestSha256
				|| JSON.stringify(stored.allocation) !== JSON.stringify(allocation)) throw new Error('Native library created state was not published exactly.');
		});
	}
	#row(namespace: string): Row | null { const row = this.#database.prepare(`SELECT ${COLUMNS} FROM native_photo_library_scopes WHERE namespace_token=?`).get(namespace); return row ? this.#readRow(row) : null; }
	#readRow(row: Record<string, unknown>): Row {
		if (typeof row.allocation !== 'string' || Buffer.byteLength(row.allocation, 'utf8') > 2048) throw new TypeError('Native library allocation exceeds its stored byte bound.');
		const parsed: unknown = JSON.parse(row.allocation), allocation = normalizePhotoLibraryRestoreAllocationV1(parsed);
		const expected = lightscaperNativePhotoLibraryManifestCurrentV1(this.#owner, allocation);
		if (row.namespace_token !== allocation.namespaceToken || JSON.stringify(allocation) !== row.allocation || row.manifest_sha256 !== expected.sha256
			|| (row.state !== 'reserved' && row.state !== 'created')) throw new Error('Native library allocation scalar identity is corrupt.');
		return Object.freeze({ allocation, sha256: expected.sha256, state: row.state });
	}
	#transaction<T>(writing: boolean, signal: AbortSignal | undefined, run: () => T): T {
		if (this.#database.isTransaction) throw new Error('Native library registry has an unsettled transaction.');
		check(signal); this.#database.exec(writing ? 'BEGIN IMMEDIATE' : 'BEGIN');
		try { const result = run(); check(signal); this.#database.exec('COMMIT'); if (!writing) check(signal); return result; }
		catch (primary) { try { if (this.#database.isTransaction) this.#database.exec('ROLLBACK'); }
			catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native library registry operation and rollback failed.', { cause: cleanup }); } throw primary; }
	}
	#request<Input, Result>(capture: () => Input, signal: AbortSignal | undefined, run: (input: Input) => Result | Promise<Result>): Promise<Result> {
		if (this.#closing) return Promise.reject(new Error('Native library registry is closing or closed.'));
		let captured: Readonly<{ input: Input }> | null = null, failure: unknown;
		const pending = this.#tail.then(() => { if (!captured) throw failure; check(signal); return run(captured.input); });
		this.#tail = pending.then(() => undefined, () => undefined);
		try { if (signal !== undefined) assertPhotoStackQuerySignalV1(signal); check(signal); const input = capture(); check(signal); captured = Object.freeze({ input }); }
		catch (error) { try { check(signal); } catch (aborted) { failure = aborted; return pending; } failure = error; }
		return pending;
	}
}
function token(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) throw new TypeError('Native library namespace requires 32 lowercase hexadecimal characters.'); return value; }
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
