/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, realpath } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve } from 'node:path';
import { readClosedDomainField, readClosedDomainRecord } from '../src/common/editor/closed-domain-value.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import type { CatalogOriginalInspectionOutcomeV1 } from '../src/common/editor/storage/media-catalog-original-inspection-repository.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 as CHUNK, readLightscaperNativeOriginalCurrentV1 } from './lightscaper-native-original-contract-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1, LightscaperNativePhotoOriginalIndexCurrentV1, readLightscaperNativeOriginalBindingCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import type { LightscaperNativeOriginalBindingCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import { LightscaperNativeOriginalFilesCurrentV1, prepareLightscaperNativeOriginalStorageCurrentV1 } from './lightscaper-native-original-files-current-v1.ts';
import { openLightscaperNativePhotoMediaDatabaseCurrentV1 } from './lightscaper-native-photo-media-files-current-v1.ts';

type Options = Readonly<{ signal?: AbortSignal }>;
declare const PUBLICATION: unique symbol;
export type LightscaperNativeOriginalPublicationCurrentV1 = Readonly<{ [PUBLICATION]: true }>;
type PublicationAuthority = { retired: boolean };
const PUBLICATIONS = new WeakMap<object, Readonly<{ authority: PublicationAuthority; path: string; binding: Readonly<LightscaperNativeOriginalBindingCurrentV1> }>>();
const NATIVE_PREPARE = DatabaseSync.prototype.prepare;

/** First main-private native Photo persistence component. Catalog authority and
 * renderer IPC are intentionally composed by their later owning adapter; a
 * caller descriptor alone never grants renderer access to this object. */
export class LightscaperNativeOriginalStoreCurrentV1 {
	readonly #database: DatabaseSync;
	readonly #index: LightscaperNativePhotoOriginalIndexCurrentV1;
	readonly #files: LightscaperNativeOriginalFilesCurrentV1;
	readonly #databasePath: string;
	readonly #publicationAuthority: PublicationAuthority = { retired: false };
	#tail: Promise<void> = Promise.resolve();
	#closing: Promise<void> | null = null;
	private constructor(database: DatabaseSync, index: LightscaperNativePhotoOriginalIndexCurrentV1, files: LightscaperNativeOriginalFilesCurrentV1, databasePath: string) {
		this.#database = database; this.#index = index; this.#files = files; this.#databasePath = databasePath;
	}

	static async open(options: Readonly<{ appDataPath: string }>): Promise<LightscaperNativeOriginalStoreCurrentV1> {
		const input = readClosedDomainRecord(options, 'native Original store', ['appDataPath']);
		const root = readClosedDomainField(input, 'appDataPath', 'native Original store');
		if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root || root.includes('\0')) throw new TypeError('Native Original appData must be an explicit canonical absolute directory.');
		// Inspect existing body locations without creating or changing them.
		// Foreign SQLite must also be refused before any body preparation.
		const derived = deriveLightscaperNativePhotoOriginalPathsCurrentV1(root);
		for (const path of [derived.bodiesRoot, derived.stagingRoot]) {
			try {
				const entry = await lstat(path);
				if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path) throw new Error('Native Original storage requires canonical real directories.');
			} catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
		}
		const database = await openLightscaperNativePhotoMediaDatabaseCurrentV1(root);
		try {
			const paths = await prepareLightscaperNativeOriginalStorageCurrentV1(root);
			const index = new LightscaperNativePhotoOriginalIndexCurrentV1(database);
			const files = new LightscaperNativeOriginalFilesCurrentV1(paths);
			await files.syncIndexDirectory();
			return new LightscaperNativeOriginalStoreCurrentV1(database, index, files, paths.databasePath);
		} catch (error) {
			try { database.close(); }
			catch (cleanup) { throw new AggregateError([error, cleanup], 'Native Original opening and database retirement failed.', { cause: cleanup }); }
			throw error;
		}
	}

	store(value: unknown, chunks: AsyncIterable<Uint8Array>, options: Options = {}): Promise<Readonly<PhotoOriginalV1>> {
		return this.#request(() => readLightscaperNativeOriginalCurrentV1(value), options, async (original, signal) => {
			await this.#store(physical(original), chunks, signal);
			return original;
		});
	}
	storeBinding(value: unknown, chunks: AsyncIterable<Uint8Array>, options: Options = {}): Promise<LightscaperNativeOriginalPublicationCurrentV1> {
		return this.#request(() => readLightscaperNativeOriginalBindingCurrentV1(value), options,
			(binding, signal) => this.#store(binding, chunks, signal));
	}

	verify(value: unknown, options: Options = {}): Promise<void> {
		return this.#request(() => readLightscaperNativeOriginalCurrentV1(value), options, async (original, signal) => {
			await this.#files.verify(this.#require(physical(original)), signal);
		});
	}

	read(value: unknown, offset: number, length: number, options: Options = {}): Promise<Uint8Array> {
		return this.#request(() => readLightscaperNativeOriginalCurrentV1(value), options,
			(original, signal) => this.#read(physical(original), offset, length, signal));
	}
	verifyBinding(value: unknown, options: Options = {}): Promise<void> {
		return this.#request(() => readLightscaperNativeOriginalBindingCurrentV1(value), options,
			async (binding, signal) => { await this.#files.verify(this.#require(binding), signal); });
	}
	inspectBinding(value: unknown, options: Options = {}): Promise<CatalogOriginalInspectionOutcomeV1> {
		return this.#request(() => readLightscaperNativeOriginalBindingCurrentV1(value), options,
			(binding, signal) => {
				const row = this.#database.prepare(`SELECT storage_key,
					CASE WHEN typeof(content_sha256)='text' AND length(CAST(content_sha256 AS BLOB))=64 THEN content_sha256 END AS content_sha256,
					byte_length FROM native_photo_original_bindings WHERE storage_key=?`).get(binding.storageKey);
				if (!row) throw new ReferenceError('Native Original has no committed physical binding.');
				const stored = readLightscaperNativeOriginalBindingCurrentV1({ storageKey: row.storage_key, byteLength: row.byte_length, contentSha256: row.content_sha256 });
				assertBinding(stored, binding); return this.#files.inspect(stored, signal);
			});
	}
	readBinding(value: unknown, offset: number, length: number, options: Options = {}): Promise<Uint8Array> {
		return this.#request(() => readLightscaperNativeOriginalBindingCurrentV1(value), options,
			(binding, signal) => this.#read(binding, offset, length, signal));
	}

	/** Fence synchronously and join admitted producer/FS work, including iterator
	 * return/finally. Never abandon a held next() with an abort Promise.race. */
	close(): Promise<void> {
		this.#closing ??= this.#tail.then(async () => {
			this.#publicationAuthority.retired = true;
			const failures: unknown[] = [];
			try { await this.#files.retire(); } catch (error) { failures.push(error); }
			try { this.#database.close(); } catch (error) { failures.push(error); }
			if (failures.length) throw new AggregateError(failures, 'Native Original owner retirement failed.');
		});
		return this.#closing;
	}
	async #store(expected: Readonly<LightscaperNativeOriginalBindingCurrentV1>, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<LightscaperNativeOriginalPublicationCurrentV1> {
		const existing = this.#index.get(expected.storageKey);
		if (existing) assertBinding(existing, expected);
		await this.#files.put(expected, chunks, signal);
		signal?.throwIfAborted();
		// Files precede authority. A failed SQL publication leaves an orphan body
		// for a safe retry; deleting it could destroy a different live binding.
		this.#index.putBindingIfAbsent(expected);
		await this.#files.syncIndexDirectory();
		const proof = Object.freeze({}) as LightscaperNativeOriginalPublicationCurrentV1;
		PUBLICATIONS.set(proof, { authority: this.#publicationAuthority, path: this.#databasePath, binding: expected });
		return proof;
	}
	async #read(expected: Readonly<LightscaperNativeOriginalBindingCurrentV1>, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
		const binding = this.#require(expected);
		if (!Number.isSafeInteger(offset) || offset < 0 || Object.is(offset, -0) || !Number.isSafeInteger(length) || length < 1
			|| length > CHUNK || offset > binding.byteLength - length) throw new RangeError('Native Original read leaves its bounded body.');
		return this.#files.read(binding, offset, length, signal);
	}
	#require(expected: Readonly<LightscaperNativeOriginalBindingCurrentV1>): LightscaperNativeOriginalBindingCurrentV1 {
		const stored = this.#index.get(expected.storageKey);
		if (!stored) throw new ReferenceError('Native Original has no committed physical binding.');
		assertBinding(stored, expected); return stored;
	}
	#request<Input, T>(capture: () => Input, options: Options, run: (input: Input, signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
		if (this.#closing) return Promise.reject(new Error('Native Original store is closing or closed.'));
		let captured: Readonly<{ input: Input; signal: AbortSignal | undefined }> | null = null;
		let captureFailure: unknown;
		// Register before touching borrowed records. Even a Proxy trap that
		// requests close during validation must join this admitted operation.
		const task = this.#tail.then(() => {
			if (!captured) throw captureFailure;
			if (this.#database.isTransaction) throw new Error('Native Original store has an unsettled transaction.');
			captured.signal?.throwIfAborted(); return run(captured.input, captured.signal);
		});
		this.#tail = task.then(() => undefined, () => undefined);
		try {
			// Pin inert metadata at admission, before waiting behind an upload.
			// A caller cannot retarget queued work by later mutating its record.
			const signal = readSignal(options), input = capture();
			captured = Object.freeze({ input, signal });
		} catch (error) { captureFailure = error; }
		return task;
	}
}

/** Main-private one-use handoff from actual file/index publication. No caller
 * descriptor, proxied token or matching filename can fabricate this proof. */
export function consumeLightscaperNativeOriginalPublicationCurrentV1(value: unknown, database: DatabaseSync): Readonly<LightscaperNativeOriginalBindingCurrentV1> {
	const proof = value !== null && typeof value === 'object' ? PUBLICATIONS.get(value) : undefined;
	if (!proof || proof.authority.retired) throw new TypeError('Native Original publication proof is absent, used or retired.');
	const location = Reflect.apply(NATIVE_PREPARE, database, ['PRAGMA database_list']).get();
	// Node installs this native, nonconfigurable getter on each real instance.
	// The intrinsic prepare above brands the receiver before any descriptor read.
	const transaction = Object.getOwnPropertyDescriptor(database, 'isTransaction');
	if (!transaction || transaction.configurable !== false || typeof transaction.get !== 'function'
		|| Reflect.apply(transaction.get, database, []) !== true) throw new Error('Native Original publication requires the consuming transaction.');
	if (location?.name !== 'main' || location.file !== proof.path) throw new Error('Native Original publication proof belongs to a different namespace.');
	PUBLICATIONS.delete(value as object);
	return proof.binding;
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
