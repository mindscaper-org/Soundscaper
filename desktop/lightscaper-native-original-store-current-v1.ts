/* SPDX-License-Identifier: AGPL-3.0-only */

import { chmod, lstat, realpath } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve } from 'node:path';
import { readClosedDomainField, readClosedDomainRecord } from '../src/common/editor/closed-domain-value.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 as CHUNK, readLightscaperNativeOriginalCurrentV1 } from './lightscaper-native-original-contract-current-v1.ts';
import { LightscaperNativePhotoOriginalIndexCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import type { LightscaperNativeOriginalBindingCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import { LightscaperNativeOriginalFilesCurrentV1, prepareLightscaperNativeOriginalStorageCurrentV1 } from './lightscaper-native-original-files-current-v1.ts';

type Options = Readonly<{ signal?: AbortSignal }>;

/** First main-private native Photo persistence component. Catalog authority and
 * renderer IPC are intentionally composed by their later owning adapter; a
 * caller descriptor alone never grants renderer access to this object. */
export class LightscaperNativeOriginalStoreCurrentV1 {
	readonly #database: DatabaseSync;
	readonly #index: LightscaperNativePhotoOriginalIndexCurrentV1;
	readonly #files: LightscaperNativeOriginalFilesCurrentV1;
	#tail: Promise<void> = Promise.resolve();
	#closing: Promise<void> | null = null;
	private constructor(database: DatabaseSync, index: LightscaperNativePhotoOriginalIndexCurrentV1, files: LightscaperNativeOriginalFilesCurrentV1) {
		this.#database = database; this.#index = index; this.#files = files;
	}

	static async open(options: Readonly<{ appDataPath: string }>): Promise<LightscaperNativeOriginalStoreCurrentV1> {
		const input = readClosedDomainRecord(options, 'native Original store', ['appDataPath']);
		const root = readClosedDomainField(input, 'appDataPath', 'native Original store');
		if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root || root.includes('\0')) throw new TypeError('Native Original appData must be an explicit canonical absolute directory.');
		const paths = await prepareLightscaperNativeOriginalStorageCurrentV1(root);
		const database = new DatabaseSync(paths.databasePath, { allowExtension: false, enableDoubleQuotedStringLiterals: false, timeout: 50 });
		try {
			const index = new LightscaperNativePhotoOriginalIndexCurrentV1(database);
			const entry = await lstat(paths.databasePath);
			if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || await realpath(paths.databasePath) !== paths.databasePath) throw new Error('Native Original database path changed while opening.');
			await chmod(paths.databasePath, 0o600);
			database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
			const files = new LightscaperNativeOriginalFilesCurrentV1(paths);
			await files.syncIndexDirectory();
			return new LightscaperNativeOriginalStoreCurrentV1(database, index, files);
		} catch (error) {
			try { database.close(); }
			catch (cleanup) { throw new AggregateError([error, cleanup], 'Native Original opening and database retirement failed.', { cause: cleanup }); }
			throw error;
		}
	}

	store(value: unknown, chunks: AsyncIterable<Uint8Array>, options: Options = {}): Promise<Readonly<PhotoOriginalV1>> {
		return this.#request(value, options, async (original, signal) => {
			const expected = physical(original);
			const existing = this.#index.get(original.storageKey);
			if (existing) assertBinding(existing, expected);
			await this.#files.put(expected, chunks, signal);
			signal?.throwIfAborted();
			// Files precede authority. A SQL failure leaves an unreferenced complete
			// body for a safe retry; deleting it could destroy another live binding.
			this.#index.putIfAbsent(original);
			await this.#files.syncIndexDirectory();
			return original;
		});
	}

	verify(value: unknown, options: Options = {}): Promise<void> {
		return this.#request(value, options, async (original, signal) => {
			await this.#files.verify(this.#require(original), signal);
		});
	}

	read(value: unknown, offset: number, length: number, options: Options = {}): Promise<Uint8Array> {
		return this.#request(value, options, async (original, signal) => {
			const binding = this.#require(original);
			if (!Number.isSafeInteger(offset) || offset < 0 || Object.is(offset, -0) || !Number.isSafeInteger(length) || length < 1
				|| length > CHUNK || offset > binding.byteLength - length) throw new RangeError('Native Original read leaves its bounded body.');
			return this.#files.read(binding, offset, length, signal);
		});
	}

	/** Fence synchronously and join admitted producer/FS work, including iterator
	 * return/finally. Never abandon a held next() with an abort Promise.race. */
	close(): Promise<void> {
		this.#closing ??= this.#tail.then(async () => {
			const failures: unknown[] = [];
			try { await this.#files.retire(); } catch (error) { failures.push(error); }
			try { this.#database.close(); } catch (error) { failures.push(error); }
			if (failures.length) throw new AggregateError(failures, 'Native Original owner retirement failed.');
		});
		return this.#closing;
	}
	#require(original: Readonly<PhotoOriginalV1>): LightscaperNativeOriginalBindingCurrentV1 {
		const expected = physical(original), stored = this.#index.get(expected.storageKey);
		if (!stored) throw new ReferenceError('Native Original has no committed physical binding.');
		assertBinding(stored, expected); return stored;
	}
	#request<T>(value: unknown, options: Options, run: (original: Readonly<PhotoOriginalV1>, signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
		if (this.#closing) return Promise.reject(new Error('Native Original store is closing or closed.'));
		let captured: Readonly<{ original: Readonly<PhotoOriginalV1>; signal: AbortSignal | undefined }> | null = null;
		let captureFailure: unknown;
		// Register before touching borrowed records. Even a Proxy trap that
		// requests close during validation must join this admitted operation.
		const task = this.#tail.then(() => {
			if (!captured) throw captureFailure;
			captured.signal?.throwIfAborted(); return run(captured.original, captured.signal);
		});
		this.#tail = task.then(() => undefined, () => undefined);
		try {
			// Pin inert metadata at admission, before waiting behind an upload.
			// A caller cannot retarget queued work by later mutating its record.
			const signal = readSignal(options), original = readLightscaperNativeOriginalCurrentV1(value);
			captured = Object.freeze({ original, signal });
		} catch (error) { captureFailure = error; }
		return task;
	}
}

function physical(original: Readonly<PhotoOriginalV1>): LightscaperNativeOriginalBindingCurrentV1 {
	return Object.freeze({ storageKey: original.storageKey, byteLength: original.byteLength, contentSha256: original.contentSha256 });
}
function assertBinding(actual: LightscaperNativeOriginalBindingCurrentV1, expected: LightscaperNativeOriginalBindingCurrentV1): void {
	if (actual.storageKey !== expected.storageKey || actual.contentSha256 !== expected.contentSha256 || actual.byteLength !== expected.byteLength) throw new Error('Native Original storage key already owns different immutable bytes.');
}
function readSignal(options: Options): AbortSignal | undefined {
	const input = readClosedDomainRecord(options, 'native Original options', ['signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? readClosedDomainField(input, 'signal', 'native Original options') : undefined;
	if (signal !== undefined) {
		if (!(signal instanceof AbortSignal)) throw new TypeError('Native Original cancellation requires a native AbortSignal.');
		Reflect.apply(AbortSignal.prototype.throwIfAborted, signal, []);
	}
	return signal as AbortSignal | undefined;
}
