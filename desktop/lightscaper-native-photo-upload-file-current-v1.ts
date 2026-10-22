/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash, randomBytes } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../src/common/editor/closed-domain-value.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 as CHUNK,
	LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 as MAXIMUM } from './lightscaper-native-original-contract-current-v1.ts';
import { lightscaperNativePhotoUploadNamespaceCurrentV1 as namespace } from './lightscaper-native-photo-upload-namespace-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check, linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
export { assertLightscaperNativePhotoUploadFilesCurrentV1 } from './lightscaper-native-photo-upload-namespace-current-v1.ts';
type Options = Readonly<{ signal?: AbortSignal }>;
export interface LightscaperNativePhotoUploadReadCurrentV1 {
	readonly byteLength: number; readonly contentSha256: string;
	read(offset: number, length: number, options?: Options): Promise<Uint8Array>;
	close(): Promise<void>;
}
interface Completion { readonly owner: LightscaperNativePhotoUploadFileCurrentV1; used: boolean; claim(database: DatabaseSync): Readonly<LightscaperNativePhotoUploadReadCurrentV1> }
interface Deferred<T> { readonly promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void }
const proofs = new WeakMap<object, Completion>(), retirements = new WeakMap<object, Promise<void>>();
const NativeBytes = Uint8Array, NativeController = AbortController;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!, ABORT = AbortController.prototype.abort;
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')!.get!;
function deferred<T>(): Deferred<T> { let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
	const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; }); return { promise, resolve, reject }; }
function same(a: BigIntStats, b: BigIntStats): boolean { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs; }
function code(value: unknown, expected: string): boolean { return value !== null && typeof value === 'object' && 'code' in value && value.code === expected; }

/** Explicit actual-file owner. Only its full native hash can issue a one-use
 * namespace proof. No caller descriptor/iterator, Blob or GC owns this FD. */
export class LightscaperNativePhotoUploadFileCurrentV1 {
	readonly #namespace: ReturnType<typeof namespace>;
	readonly #registration: ReturnType<ReturnType<typeof namespace>['register']>;
	readonly #terminal = deferred<void>(); readonly #stop = new NativeController();
	readonly #cleanup: unknown[] = []; readonly #unretiredHandles = new Set<FileHandle>();
	#expectedBytes = 0; #expectedSha256 = ''; #written = 0; #path = ''; #created: BigIntStats | undefined;
	#output: FileHandle | undefined; #input: FileHandle | undefined; #stamp: BigIntStats | undefined;
	#opening: Promise<void> = Promise.resolve(); #writeWork: Promise<void> | undefined; #readWork: Promise<Uint8Array> | undefined;
	#finishWork: Promise<Readonly<object>> | undefined; #closing: Promise<void> | undefined; #retiring: Promise<void> | undefined;
	#closed = false; #ready = false; #allocated = false; #failed = false; #failure: unknown;
	private constructor(database: DatabaseSync, value: unknown) {
		this.#namespace = namespace(database); this.#registration = this.#namespace.register(this);
		retirements.set(this, this.#terminal.promise); void this.#terminal.promise.catch(() => undefined);
		try {
			const input = record(value, 'native repair upload', ['expectedBytes', 'expectedSha256']);
			const bytes = field(input, 'expectedBytes', 'native repair upload'), sha = field(input, 'expectedSha256', 'native repair upload');
			if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAXIMUM
				|| typeof sha !== 'string' || sha.length !== 64 || !/^[a-f0-9]+$/u.test(sha)) throw new RangeError('Native repair upload has invalid length or SHA.');
			this.#expectedBytes = bytes; this.#expectedSha256 = sha;
			this.#opening = this.#open(); void this.#opening.catch(() => undefined); Object.freeze(this);
		} catch (error) { this.#closed = true; this.#registration.release(); this.#terminal.resolve(); throw error; }
	}
	static create(database: DatabaseSync, options: Readonly<{ expectedBytes: number; expectedSha256: string }>): LightscaperNativePhotoUploadFileCurrentV1 {
		return new LightscaperNativePhotoUploadFileCurrentV1(database, options);
	}
	readonly write = (value: Uint8Array): Promise<void> => {
		try { this.#accept(); if (this.#finishWork || this.#writeWork) throw new Error('Native repair upload write is pending or sealed.'); }
		catch (error) { return Promise.reject(error); }
		const completion = deferred<void>(); this.#writeWork = completion.promise;
		let bytes: Uint8Array | undefined, failed = false, primary: unknown;
		try {
			if (!types.isUint8Array(value)) throw new TypeError('Native upload requires actual Uint8Array bytes.');
			const length: unknown = Reflect.apply(BYTE_LENGTH, value, []);
			if (typeof length !== 'number' || length < 1 || length > CHUNK || length > this.#expectedBytes - this.#written) throw new RangeError('Native upload chunk leaves its exact bounded body.');
			bytes = new NativeBytes(value);
		} catch (error) { failed = true; primary = error; }
		void (async () => {
			try {
				await this.#opening; this.#accept(); if (failed) throw primary;
				if (!bytes || !this.#output) throw new Error('Native upload has no admitted output.');
				for (let offset = 0; offset < bytes.byteLength;) {
					check(this.#signal()); const result = await this.#output.write(bytes, offset, bytes.byteLength - offset, this.#written + offset);
					if (result.bytesWritten < 1) throw new Error('Native upload file stopped accepting bytes.'); offset += result.bytesWritten;
				}
				check(this.#signal()); this.#written += bytes.byteLength;
			} catch (error) { await this.#failedOperation(error); }
			finally { bytes?.fill(0); }
		})().then(() => { this.#writeWork = undefined; completion.resolve(); }, error => { this.#writeWork = undefined; completion.reject(error); });
		return completion.promise;
	};
	readonly finish = (): Promise<Readonly<object>> => {
		if (this.#finishWork) return this.#finishWork;
		try { this.#accept(); } catch (error) { return Promise.reject(error); }
		const completion = deferred<Readonly<object>>(); this.#finishWork = completion.promise; const writing = this.#writeWork;
		void (async () => {
			try {
				await this.#opening; await writing; this.#accept();
				if (!this.#output || this.#written !== this.#expectedBytes) throw new Error('Native upload did not deliver its complete exact body.');
				await this.#output.sync();
				try { await this.#output.close(); this.#output = undefined; } catch (error) { this.#quarantine(error); throw error; }
				check(this.#signal());
				await directory(this.#namespace.stagingRoot);
				this.#input = await open(this.#path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
				this.#stamp = await this.#input.stat({ bigint: true }); await this.#verifyFile();
				const hash = createHash('sha256');
				for (let offset = 0; offset < this.#expectedBytes;) {
					const bytes = await this.#range(offset, Math.min(CHUNK, this.#expectedBytes - offset), this.#signal());
					try { hash.update(bytes); offset += bytes.byteLength; } finally { bytes.fill(0); }
				}
				if (hash.digest('hex') !== this.#expectedSha256) throw new Error('Native completed upload actual SHA differs from its declaration.');
				await this.#syncDirectory(); this.#accept(); this.#ready = true;
				const proof = Object.freeze({}); proofs.set(proof, { owner: this, used: false, claim: db => this.#claim(db) }); return proof;
			} catch (error) { return this.#failedOperation(error); }
		})().then(completion.resolve, completion.reject); return completion.promise;
	};
	#claim(database: DatabaseSync): Readonly<LightscaperNativePhotoUploadReadCurrentV1> {
		this.#accept(); if (!this.#ready || namespace(database).path !== this.#namespace.path) throw new Error('Native upload proof belongs to another or unfinished namespace.');
		return Object.freeze<LightscaperNativePhotoUploadReadCurrentV1>({ byteLength: this.#expectedBytes, contentSha256: this.#expectedSha256,
			read: (offset, length, options) => this.#read(offset, length, options), close: this.close });
	}
	#read(offset: number, length: number, value: Options = {}): Promise<Uint8Array> {
		try { this.#accept(); if (this.#readWork) throw new Error('Native upload source read is already pending.'); }
		catch (error) { return Promise.reject(error); }
		const completion = deferred<Uint8Array>(); this.#readWork = completion.promise;
		let linked: ReturnType<typeof link> | undefined, captured = false, primary: unknown;
		try {
			const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
			const signal: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
			if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
			linked = link(signal as AbortSignal | undefined, this.#signal());
			const input = record(value, 'native upload range options', ['signal'], []);
			if ((Object.hasOwn(input, 'signal') ? field(input, 'signal', 'native upload range options') : undefined) !== signal) throw new TypeError('Native upload range signal changed during admission.');
			if (!Number.isSafeInteger(offset) || offset < 0 || Object.is(offset, -0) || !Number.isSafeInteger(length) || length < 1 || length > CHUNK
				|| offset > this.#expectedBytes - length) throw new RangeError('Native upload range leaves its exact bounded source.'); captured = true;
		} catch (error) { primary = error; }
		void (async () => {
			let bytes: Uint8Array | undefined, failed = false, error: unknown;
			try { check(linked?.signal ?? this.#signal()); if (!captured) throw primary; bytes = await this.#range(offset, length, linked?.signal ?? this.#signal()); }
			catch (failure) { failed = true; error = failure; }
			try { linked?.detach(); } catch (cleanup) { bytes?.fill(0); this.#quarantine(cleanup); throw new AggregateError([...(failed ? [error] : []), cleanup], 'Native upload read signal retirement failed.', { cause: cleanup }); }
			if (failed) throw error; return bytes!;
		})().then(bytes => { this.#readWork = undefined; completion.resolve(bytes); }, error => { this.#readWork = undefined; completion.reject(error); });
		return completion.promise;
	}
	readonly close = (): Promise<void> => {
		if (this.#closing) return this.#closing;
		const completion = deferred<void>(); this.#closing = completion.promise; this.#closed = true;
		try { Reflect.apply(ABORT, this.#stop, [new Error('Native upload file is closing.')]); } catch (error) { this.#quarantine(error); }
		const active = [this.#opening, this.#writeWork, this.#finishWork, this.#readWork].filter(value => value !== undefined);
		void Promise.allSettled(active).then(() => this.#retire()).then(completion.resolve, completion.reject); return completion.promise;
	};
	#signal(): AbortSignal { return Reflect.apply(SIGNAL, this.#stop, []) as AbortSignal; }
	#accept(): void { this.#namespace.assertCurrent(); check(this.#signal()); if (this.#failed) throw this.#failure; if (this.#closed) throw new Error('Native upload file is closed.'); }
	async #open(): Promise<void> {
		await directory(dirname(this.#namespace.stagingRoot)); await directory(this.#namespace.stagingRoot); this.#accept();
		this.#path = join(this.#namespace.stagingRoot, `upload-${randomBytes(32).toString('hex')}.part`);
		this.#output = await open(this.#path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
		this.#allocated = true; this.#created = await this.#output.stat({ bigint: true });
		if (!this.#created.isFile() || this.#created.nlink !== 1n) throw new Error('Native upload did not create a private regular file.'); this.#accept();
	}
	async #range(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
		this.#namespace.assertCurrent(); check(signal); await this.#verifyFile(); this.#namespace.assertCurrent(); const bytes = new NativeBytes(length);
		try {
			if (!this.#input) throw new Error('Native upload has no actual completed input.');
			for (let read = 0; read < length;) {
				check(signal); const receipt = await this.#input.read(bytes, read, length - read, offset + read);
				if (receipt.bytesRead < 1) throw new Error('Native upload ended before its exact range.'); read += receipt.bytesRead;
			}
			await this.#verifyFile(); this.#namespace.assertCurrent(); check(signal); return bytes;
		} catch (error) { bytes.fill(0); throw error; }
	}
	async #verifyFile(): Promise<void> {
		if (!this.#input || !this.#stamp || !this.#created) throw new Error('Native upload has no immutable completed file.');
		const actual = await this.#input.stat({ bigint: true }), path = await lstat(this.#path, { bigint: true });
		if (!actual.isFile() || actual.nlink !== 1n || !path.isFile() || path.isSymbolicLink() || path.nlink !== 1n
			|| actual.size !== BigInt(this.#expectedBytes) || actual.dev !== this.#created.dev || actual.ino !== this.#created.ino
			|| !same(this.#stamp, actual) || !same(actual, path) || await realpath(this.#path) !== this.#path) throw new Error('Native completed upload changed its actual file identity.');
	}
	async #failedOperation(primary: unknown): Promise<never> {
		try { check(this.#signal()); } catch (reason) { primary = reason; }
		if (!this.#failed) { this.#failed = true; this.#failure = primary; }
		this.#closed = true;
		try { await this.#retire(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native upload operation and actual retirement failed.', { cause: cleanup }); }
		throw primary;
	}
	#quarantine(error: unknown): void { if (!this.#cleanup.some(value => Object.is(value, error))) this.#cleanup.push(error); this.#registration.quarantine(error); this.#terminal.reject(error); }
	#retire(): Promise<void> {
		if (this.#retiring) return this.#retiring;
		const completion = deferred<void>(); this.#retiring = completion.promise;
		void (async () => {
			await Promise.allSettled([this.#opening]); const failures: unknown[] = [...this.#cleanup];
			for (const key of ['output', 'input'] as const) {
				const handle = key === 'output' ? this.#output : this.#input; if (!handle) continue;
				try { await handle.close(); if (key === 'output') this.#output = undefined; else this.#input = undefined; }
				catch (error) { failures.push(error); this.#quarantine(error); }
			}
			if (this.#allocated && !this.#created) { const error = new Error('Native upload created-file identity was not proved.'); failures.push(error); this.#quarantine(error); }
			if (!failures.length && this.#created) {
				try {
					await directory(this.#namespace.stagingRoot);
					let current: BigIntStats | undefined;
					try { current = await lstat(this.#path, { bigint: true }); } catch (error) { if (!code(error, 'ENOENT')) throw error; }
					if (current) {
						if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1n || current.dev !== this.#created.dev || current.ino !== this.#created.ino)
							throw new Error('Native upload cleanup refuses a replaced file.');
						await unlink(this.#path); await this.#syncDirectory();
					}
				} catch (error) { failures.push(error); this.#quarantine(error); }
			}
			if (failures.length) throw new AggregateError(failures, 'Native upload actual file retirement is unproved.');
			this.#registration.release(); this.#terminal.resolve();
		})().then(completion.resolve, completion.reject); return completion.promise;
	}
	async #syncDirectory(): Promise<void> {
		if (process.platform === 'win32') return;
		const handle = await open(this.#namespace.stagingRoot, constants.O_RDONLY); let failed = false, primary: unknown;
		try { await handle.sync(); } catch (error) { failed = true; primary = error; }
		try { await handle.close(); } catch (cleanup) { this.#unretiredHandles.add(handle); this.#quarantine(cleanup); throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Native upload directory retirement failed.', { cause: cleanup }); }
		if (failed) throw primary;
	}
}
export function consumeLightscaperNativePhotoUploadFileCurrentV1(value: unknown, database: DatabaseSync): Readonly<LightscaperNativePhotoUploadReadCurrentV1> {
	const proof = value !== null && typeof value === 'object' ? proofs.get(value) : undefined;
	if (!proof || proof.used) throw new TypeError('Native upload requires a genuine unused completed-file proof.');
	const view = proof.claim(database); proof.used = true; return view;
}
export function readLightscaperNativePhotoUploadFileRetirementCurrentV1(value: unknown): Promise<void> {
	const work = value !== null && typeof value === 'object' ? retirements.get(value) : undefined;
	if (!work) throw new TypeError('Native upload retirement requires its genuine owner.'); return work;
}
async function directory(path: string): Promise<void> {
	const entry = await lstat(path);
	if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path) throw new Error('Native upload requires its existing canonical private directory.');
}
