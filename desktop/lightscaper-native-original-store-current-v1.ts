/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
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

import { readLightscaperNativeOriginalBodyHeadCurrentV1 as readHead, reserveLightscaperNativeOriginalBodyLocatorCurrentV1 as reserveLocator, type LightscaperNativeOriginalBodyHeadCurrentV1 as Head } from './lightscaper-native-original-body-head-current-v1.ts';
import { registerLightscaperNativeOriginalPhysicalNamespaceCurrentV1 as registerNamespace } from './lightscaper-native-original-physical-namespace-current-v1.ts';

type Options = Readonly<{ signal?: AbortSignal }>;
declare const PUBLICATION: unique symbol;
export type LightscaperNativeOriginalPublicationCurrentV1 = Readonly<{ [PUBLICATION]: true }>;
type PublicationAuthority = { retired: boolean };
const PUBLICATIONS = new WeakMap<object, Readonly<{ authority: PublicationAuthority; path: string; binding: Readonly<LightscaperNativeOriginalBindingCurrentV1>; expectedHead: Readonly<Head> }>>();
export interface LightscaperNativeOriginalBindingReadCurrentV1 {
 read(offset: number, length: number, options?: Options): Promise<Uint8Array>;
 close(): Promise<void>;
}
type RepairOptions = Readonly<{ signal?: AbortSignal; expectedHead?: Readonly<Head> }>;
declare const REPAIR: unique symbol;
export type LightscaperNativeOriginalRepairPublicationCurrentV1 = Readonly<{ [REPAIR]: true }>;
type RepairState = { authority: PublicationAuthority; path: string; binding: Readonly<LightscaperNativeOriginalBindingCurrentV1>; expectedHead: Readonly<Head>; locatorId: string; status: 'fresh' | 'used' | 'retired'; release(): void };
const REPAIRS = new WeakMap<object, RepairState>(), OPENING_QUARANTINE = new Set<object>();
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
const NATIVE_PREPARE = DatabaseSync.prototype.prepare;

/** First main-private native Photo persistence component. Catalog authority and
 * renderer IPC are intentionally composed by their later owning adapter; a
 * caller descriptor alone never grants renderer access to this object. */
export class LightscaperNativeOriginalStoreCurrentV1 {
	readonly #database: DatabaseSync;
	readonly #index: LightscaperNativePhotoOriginalIndexCurrentV1;
	readonly #files: LightscaperNativeOriginalFilesCurrentV1;
	readonly #databasePath: string;
	readonly #namespace: ReturnType<typeof registerNamespace>;
	readonly #leases = new Set<() => Promise<void>>(); readonly #repairProofs = new Set<RepairState>();
	readonly #publicationAuthority: PublicationAuthority = { retired: false };
	#tail: Promise<void> = Promise.resolve();
	#closing: Promise<void> | null = null;
	private constructor(database: DatabaseSync, index: LightscaperNativePhotoOriginalIndexCurrentV1, files: LightscaperNativeOriginalFilesCurrentV1, databasePath: string) {
		this.#database = database; this.#index = index; this.#files = files; this.#databasePath = databasePath; this.#namespace = registerNamespace(databasePath);
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
		let files: LightscaperNativeOriginalFilesCurrentV1 | undefined;
		try {
			const paths = await prepareLightscaperNativeOriginalStorageCurrentV1(root);
			const index = new LightscaperNativePhotoOriginalIndexCurrentV1(database);
			files = new LightscaperNativeOriginalFilesCurrentV1(paths);
			await files.syncIndexDirectory();
			return new LightscaperNativeOriginalStoreCurrentV1(database, index, files, paths.databasePath);
		} catch (error) {
			if (files?.retirementUnproved()) OPENING_QUARANTINE.add(Object.freeze({ files, database }));
			try { database.close(); }
			catch (cleanup) { OPENING_QUARANTINE.add(Object.freeze({ files, database })); throw new AggregateError([error, cleanup], 'Native Original opening and database retirement failed.', { cause: cleanup }); }
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
			const binding = this.#require(physical(original)); await this.#files.verify(binding, signal, false, readHead(this.#database, binding));
		});
	}

	read(value: unknown, offset: number, length: number, options: Options = {}): Promise<Uint8Array> {
		return this.#request(() => readLightscaperNativeOriginalCurrentV1(value), options,
			(original, signal) => this.#read(physical(original), offset, length, signal));
	}
	verifyBinding(value: unknown, options: Options = {}): Promise<void> {
		return this.#request(() => readLightscaperNativeOriginalBindingCurrentV1(value), options,
			async (binding, signal) => { const stored = this.#require(binding); await this.#files.verify(stored, signal, false, readHead(this.#database, stored)); });
	}
	inspectBinding(value: unknown, options: Options = {}): Promise<CatalogOriginalInspectionOutcomeV1> {
		return this.#request(() => readLightscaperNativeOriginalBindingCurrentV1(value), options,
			async (binding, signal) => {
				const row = this.#database.prepare(`SELECT storage_key,
					CASE WHEN typeof(content_sha256)='text' AND length(CAST(content_sha256 AS BLOB))=64 THEN content_sha256 END AS content_sha256,
					byte_length FROM native_photo_original_bindings WHERE storage_key=?`).get(binding.storageKey);
				if (!row) throw new ReferenceError('Native Original has no committed physical binding.');
				const stored = readLightscaperNativeOriginalBindingCurrentV1({ storageKey: row.storage_key, byteLength: row.byte_length, contentSha256: row.content_sha256 });
				assertBinding(stored, binding); const head = readHead(this.#database, stored);
				const result = await this.#files.inspect(stored, signal, head);
				check(signal); assertHead(readHead(this.#database, stored), head); return result;
			});
	}
	readBinding(value: unknown, offset: number, length: number, options: Options = {}): Promise<Uint8Array> {
		return this.#request(() => readLightscaperNativeOriginalBindingCurrentV1(value), options,
			(binding, signal) => this.#read(binding, offset, length, signal));
	}

	/** Resolve and pin synchronously; file IO never waits behind an idle upload. */
	acquireBindingRead(value: unknown): Readonly<LightscaperNativeOriginalBindingReadCurrentV1> { return this.#acquireBindingRead(value); }
	#acquireBindingRead(value: unknown, admitted = false): Readonly<LightscaperNativeOriginalBindingReadCurrentV1> {
	 if (admitted) this.#namespace.assertCurrent(); else this.#assertOpen();
	 if (this.#database.isTransaction) throw new Error('Native Original physical read requires committed standalone state.'); const pin = this.#namespace.pin(), active = new Set<Promise<unknown>>();
	 let closing: Promise<void> | null = null, busy = false;
	 const close = (): Promise<void> => {
	  if (closing) return closing;
	  closing = Promise.allSettled([...active]).then(async () => {
	   if (this.#files.retirementUnproved()) { this.#namespace.quarantine(this); await this.#files.retire(); throw new Error('Native Original physical read retirement is unproved.'); }
	   pin.release(); this.#leases.delete(close);
	  }); return closing;
	 };
	 this.#leases.add(close);
	 let binding: Readonly<LightscaperNativeOriginalBindingCurrentV1>, locator: Readonly<Head>;
	 try { binding = this.#require(readLightscaperNativeOriginalBindingCurrentV1(value)); locator = readHead(this.#database, binding); if (admitted) this.#namespace.assertCurrent(); else this.#assertOpen(); }
	 catch (error) { void close().catch(() => undefined); throw error; }
	 return Object.freeze({
	  read: (offset: number, length: number, options: Options = {}): Promise<Uint8Array> => {
	   if (closing || (!admitted && this.#closing) || busy) return Promise.reject(new Error('Native Original physical reader is closed or busy.'));
	   let slot: ReturnType<ReturnType<typeof registerNamespace>['read']>;
	   try { slot = this.#namespace.read(); } catch (error) { return Promise.reject(error); }
	   busy = true; let captured = false, signal: AbortSignal | undefined, primary: unknown;
	   const work = Promise.resolve().then(async () => {
	    if (!captured) throw primary; check(signal);
	    try { return await this.#files.read(binding, offset, length, signal, locator); }
	    catch (error) { if (this.#files.retirementUnproved()) this.#namespace.quarantine(this); throw error; }
	   });
	   active.add(work); void work.then(() => { active.delete(work); busy = false; slot.release(); }, () => { active.delete(work); busy = false; slot.release(); });
	   try { signal = readSignal(options); range(binding, offset, length); captured = true; }
	   catch (error) { try { check(signal); primary = error; } catch (abort) { primary = abort; } }
	   return work;
	  }, close,
	 });
	}
	prepareRepairBinding(value: unknown, chunks: AsyncIterable<Uint8Array>, options: RepairOptions = {}): Promise<LightscaperNativeOriginalRepairPublicationCurrentV1> {
	 let permit: ReturnType<ReturnType<typeof registerNamespace>['repair']>;
	 try { this.#assertOpen(); permit = this.#namespace.repair(); } catch (error) { return Promise.reject(error); }
	 let expected: unknown;
	 const work = this.#request(() => {
	  const binding = readLightscaperNativeOriginalBindingCurrentV1(value), expectedHead = readHead(this.#database, binding);
	  if (expected !== undefined) assertExpectedHead(expected, expectedHead);
	  return Object.freeze({ binding, expectedHead });
	 }, options, async (captured, signal) => {
	  const locatorId = randomBytes(32).toString('hex');
	  transaction(this.#database, () => { assertHead(readHead(this.#database, captured.binding), captured.expectedHead); reserveLocator(this.#database, captured.binding, locatorId); });
	  const locator = Object.freeze({ contentSha256: captured.binding.contentSha256, byteLength: captured.binding.byteLength, locatorId, layout: 'generation-v1' as const });
	  await this.#files.put(captured.binding, chunks, signal, locator, true); check(signal);
	  const proof = Object.freeze({}) as LightscaperNativeOriginalRepairPublicationCurrentV1;
	  const state: RepairState = { authority: this.#publicationAuthority, path: this.#databasePath, ...captured, locatorId, status: 'fresh',
	   release: (): void => { permit.release(); this.#repairProofs.delete(state); } };
	  REPAIRS.set(proof, state); this.#repairProofs.add(state); return proof;
	 }, input => {
	  const record = readClosedDomainRecord(input, 'native Original repair options', ['signal', 'expectedHead'], []);
	  expected = Object.hasOwn(record, 'expectedHead') ? readClosedDomainField(record, 'expectedHead', 'native Original repair options') : undefined;
	  return nativeSignal(Object.hasOwn(record, 'signal') ? readClosedDomainField(record, 'signal', 'native Original repair options') : undefined);
	 });
	 return work.then(proof => proof, (error: unknown) => { permit.release(); throw error; });
	}
	/** Cache the fence before any borrowed cancellation/close observer can reenter.
	 * Explicit physical leases join accepted reads before the SQL owner retires. */
	close(): Promise<void> {
	 if (this.#closing) return this.#closing;
	 let resolve!: () => void, reject!: (error: unknown) => void;
	 this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
	 const leases = [...this.#leases].map(close => close());
	 void Promise.allSettled([this.#tail, ...leases]).then(async results => {
	  this.#publicationAuthority.retired = true;
	  for (const proof of this.#repairProofs) { proof.status = 'retired'; proof.release(); }
	  const failures: unknown[] = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	  try { await this.#files.retire(); } catch (error) { failures.push(error); this.#namespace.quarantine(this); }
	  try { this.#database.close(); } catch (error) { failures.push(error); this.#namespace.quarantine(this); }
	  if (failures.length) { this.#namespace.quarantine(this); throw new AggregateError(failures, 'Native Original owner retirement failed.'); }
	  this.#namespace.retire();
	 }).then(resolve, reject); return this.#closing;
	}
	#assertOpen(): void { if (this.#closing) throw new Error('Native Original store is closing or closed.'); this.#namespace.assertCurrent(); }
	async #store(expected: Readonly<LightscaperNativeOriginalBindingCurrentV1>, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<LightscaperNativeOriginalPublicationCurrentV1> {
		const existing = this.#index.get(expected.storageKey);
		if (existing) assertBinding(existing, expected);
		const head = readHead(this.#database, expected);
		if (head.layout === 'generation-v1') await this.#files.verify(expected, signal, true, head);
		await this.#files.put(expected, chunks, signal, head);
		check(signal); assertHead(readHead(this.#database, expected), head);
		// Files precede authority. A failed SQL publication leaves an orphan body
		// for a safe retry; deleting it could destroy a different live binding.
		this.#index.putBindingIfAbsent(expected);
		await this.#files.syncIndexDirectory();
		assertHead(readHead(this.#database, expected), head);
		const proof = Object.freeze({}) as LightscaperNativeOriginalPublicationCurrentV1;
		PUBLICATIONS.set(proof, { authority: this.#publicationAuthority, path: this.#databasePath, binding: expected, expectedHead: head });
		return proof;
	}
	async #read(expected: Readonly<LightscaperNativeOriginalBindingCurrentV1>, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
		const binding = this.#require(expected);
		range(binding, offset, length); const lease = this.#acquireBindingRead(binding, true);
	 let failed = false, primary: unknown, bytes: Uint8Array | undefined;
	 try { bytes = await lease.read(offset, length, { signal }); } catch (error) { failed = true; primary = error; }
	 try { await lease.close(); }
	 catch (cleanup) { bytes?.fill(0); if (failed) throw new AggregateError([primary, cleanup], 'Native Original read and physical lease retirement failed.', { cause: cleanup }); throw cleanup; }
	 if (failed) throw primary; return bytes!;
	}
	#require(expected: Readonly<LightscaperNativeOriginalBindingCurrentV1>): LightscaperNativeOriginalBindingCurrentV1 {
		const stored = this.#index.get(expected.storageKey);
		if (!stored) throw new ReferenceError('Native Original has no committed physical binding.');
		assertBinding(stored, expected); return stored;
	}
	#request<Input, T>(capture: () => Input, options: unknown, run: (input: Input, signal: AbortSignal | undefined) => Promise<T>, captureSignal: (value: unknown) => AbortSignal | undefined = readSignal): Promise<T> {
		try { this.#assertOpen(); } catch (error) { return Promise.reject(error); }
		let captured: Readonly<{ input: Input; signal: AbortSignal | undefined }> | null = null;
		let captureFailure: unknown;
		// Register before touching borrowed records. Even a Proxy trap that
		// requests close during validation must join this admitted operation.
		const task = this.#tail.then(() => {
			if (!captured) throw captureFailure;
			if (this.#database.isTransaction) throw new Error('Native Original store has an unsettled transaction.');
			check(captured.signal); this.#namespace.assertCurrent(); return run(captured.input, captured.signal);
		});
		this.#tail = task.then(() => undefined, () => undefined);
		try {
			// Pin inert metadata at admission, before waiting behind an upload.
			// A caller cannot retarget queued work by later mutating its record.
			const signal = captureSignal(options), input = capture();
			captured = Object.freeze({ input, signal });
		} catch (error) { captureFailure = error; }
		return task.catch((error: unknown) => { if (this.#files.retirementUnproved()) this.#namespace.quarantine(this); throw error; });
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
	assertHead(readHead(database, proof.binding), proof.expectedHead);
	PUBLICATIONS.delete(value as object);
	return proof.binding;
}

function physical(original: Readonly<PhotoOriginalV1>): LightscaperNativeOriginalBindingCurrentV1 {
	return Object.freeze({ storageKey: original.storageKey, byteLength: original.byteLength, contentSha256: original.contentSha256 });
}
function assertBinding(actual: LightscaperNativeOriginalBindingCurrentV1, expected: LightscaperNativeOriginalBindingCurrentV1): void {
	if (actual.storageKey !== expected.storageKey || actual.contentSha256 !== expected.contentSha256 || actual.byteLength !== expected.byteLength) throw new Error('Native Original storage key already owns different immutable bytes.');
}
function readSignal(options: unknown): AbortSignal | undefined {
	const input = readClosedDomainRecord(options, 'native Original options', ['signal'], []);
	return nativeSignal(Object.hasOwn(input, 'signal') ? readClosedDomainField(input, 'signal', 'native Original options') : undefined);
}
function nativeSignal(value: unknown): AbortSignal | undefined {
	if (value !== undefined) { if (!(value instanceof AbortSignal)) throw new TypeError('Native Original cancellation requires a native AbortSignal.'); Reflect.apply(CHECK, value, []); }
	return value as AbortSignal | undefined;
}
function range(binding: LightscaperNativeOriginalBindingCurrentV1, offset: number, length: number): void {
	if (!Number.isSafeInteger(offset) || offset < 0 || Object.is(offset, -0) || !Number.isSafeInteger(length) || length < 1 || length > CHUNK || offset > binding.byteLength - length) throw new RangeError('Native Original read leaves its bounded body.');
}
function assertHead(actual: Readonly<Head>, expected: Readonly<Head>): void {
	if (actual.contentSha256 !== expected.contentSha256 || actual.byteLength !== expected.byteLength || actual.locatorId !== expected.locatorId || actual.layout !== expected.layout || actual.revision !== expected.revision) throw new Error('Native Original physical head changed before repair publication.');
}
function assertExpectedHead(value: unknown, actual: Readonly<Head>): void {
	const input = readClosedDomainRecord(value, 'native Original expected head', ['contentSha256', 'locatorId', 'byteLength', 'layout', 'revision']);
	for (const key of ['contentSha256', 'locatorId', 'byteLength', 'layout', 'revision'] as const) if (readClosedDomainField(input, key, 'native Original expected head') !== actual[key]) throw new Error('Native Original expected physical head is stale.');
}
function transaction<Result>(database: DatabaseSync, run: () => Result): Result {
	if (database.isTransaction) throw new Error('Native Original repair reservation requires no active transaction.'); database.exec('BEGIN IMMEDIATE');
	try { const result = run(); database.exec('COMMIT'); return result; }
	catch (primary) { try { if (database.isTransaction) database.exec('ROLLBACK'); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Original reservation rollback failed.', { cause: cleanup }); } throw primary; }
}
/** Only an actual verified fresh generation can issue this one-use handoff. */
export function consumeLightscaperNativeOriginalRepairPublicationCurrentV1(value: unknown, database: DatabaseSync): Readonly<{ binding: Readonly<LightscaperNativeOriginalBindingCurrentV1>; expectedHead: Readonly<Head>; locatorId: string }> {
	const proof = value !== null && typeof value === 'object' ? REPAIRS.get(value) : undefined;
	if (!proof || proof.status !== 'fresh' || proof.authority.retired) throw new TypeError('Native Original repair proof is absent, used or retired.');
	const location = Reflect.apply(NATIVE_PREPARE, database, ['PRAGMA database_list']).get();
	const descriptor = Object.getOwnPropertyDescriptor(database, 'isTransaction');
	if (!descriptor || descriptor.configurable !== false || typeof descriptor.get !== 'function' || Reflect.apply(descriptor.get, database, []) !== true) throw new Error('Native Original repair publication requires the consuming transaction.');
	if (location?.name !== 'main' || location.file !== proof.path) throw new Error('Native Original repair proof belongs to another physical namespace.');
	assertHead(readHead(database, proof.binding), proof.expectedHead); proof.status = 'used'; proof.release();
	return Object.freeze({ binding: proof.binding, expectedHead: proof.expectedHead, locatorId: proof.locatorId });
}
export function retireLightscaperNativeOriginalRepairPublicationCurrentV1(value: unknown): void {
	const proof = value !== null && typeof value === 'object' ? REPAIRS.get(value) : undefined;
	if (!proof) throw new TypeError('Native Original repair retirement requires a genuine proof.');
	if (proof.status === 'fresh') { proof.status = 'retired'; proof.release(); }
}
