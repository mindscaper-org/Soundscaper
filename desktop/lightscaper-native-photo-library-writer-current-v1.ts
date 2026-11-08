/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import { openLightscaperNativePhotoLibraryDatabaseCurrentV1 } from './lightscaper-native-photo-library-files-current-v1.ts';
import { initializeLightscaperNativePhotoLibraryWriterDatabaseCurrentV1 as initialize,
	inspectLightscaperNativePhotoLibraryWriterDatabaseCurrentV1 as inspect } from './lightscaper-native-photo-library-writer-database-current-v1.ts';

const CONSTRUCT = Object.freeze({});
const PROFILE = Object.freeze({ fileName: 'native-photo-library-writer.sqlite3' as const, inspect, initialize });

export class LightscaperNativePhotoLibraryWriterBusyErrorCurrentV1 extends Error {
	constructor() { super('Another process holds the native Lightscaper library writer guard.'); this.name = 'LightscaperNativePhotoLibraryWriterBusyErrorCurrentV1'; }
}

/** A real appData-wide SQLite writer transaction. The scope owner closes every
 * child/reader first and keeps this handle quarantined if retirement is unproved.
 * There is no TTL, PID takeover, heartbeat, lock-file unlink or renderer path. */
export class LightscaperNativePhotoLibraryWriterCurrentV1 {
	readonly #database: DatabaseSync;
	#closing: Promise<void> | null = null;
	#fenced = false;
	#failure: unknown;
	private constructor(database: DatabaseSync, construction: object) {
		if (construction !== CONSTRUCT) throw new TypeError('Native Photo writer requires its genuine acquisition.');
		this.#database = database; Object.freeze(this);
	}
	static async acquire(appDataPath: string): Promise<LightscaperNativePhotoLibraryWriterCurrentV1> {
		let database: DatabaseSync | undefined;
		try {
			database = await openLightscaperNativePhotoLibraryDatabaseCurrentV1(appDataPath, PROFILE);
			database.exec('BEGIN IMMEDIATE');
			return new LightscaperNativePhotoLibraryWriterCurrentV1(database, CONSTRUCT);
		} catch (primary) {
			try { database?.close(); }
			catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Photo writer acquisition and retirement failed.', { cause: cleanup }); }
			if (sqliteBusy(primary)) throw new LightscaperNativePhotoLibraryWriterBusyErrorCurrentV1();
			throw primary;
		}
	}
	assertCurrent(): void {
		if (this.#closing) throw new Error('Native Photo library writer is closing or closed.');
		if (this.#fenced) throw this.#failure;
		try { if (!this.#database.isTransaction) throw new Error('Native Photo library writer lost its actual SQLite transaction.'); }
		catch (error) { this.#fenced = true; this.#failure = error; throw error; }
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#fenced = true;
		this.#closing = Promise.resolve().then(() => {
			const failures: unknown[] = [];
			try { if (this.#database.isTransaction) this.#database.exec('ROLLBACK'); } catch (error) { failures.push(error); }
			try { this.#database.close(); } catch (error) { failures.push(error); }
			if (failures.length) throw new AggregateError(failures, 'Native Photo library writer retirement failed.');
		});
		return this.#closing;
	}
}

export function acquireLightscaperNativePhotoLibraryWriterCurrentV1(appDataPath: string): Promise<LightscaperNativePhotoLibraryWriterCurrentV1> {
	return LightscaperNativePhotoLibraryWriterCurrentV1.acquire(appDataPath);
}
function sqliteBusy(error: unknown): boolean {
	// Native branding avoids examining opaque application failures or Proxy traps.
	if (!types.isNativeError(error)) return false;
	const code: unknown = Object.getOwnPropertyDescriptor(error, 'errcode')?.value;
	return typeof code === 'number' && Number.isSafeInteger(code) && code >= 0 && [5, 6].includes(code & 0xff);
}
