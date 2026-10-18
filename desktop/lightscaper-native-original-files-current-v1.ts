/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { chmod, link, lstat, mkdir, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 as CHUNK } from './lightscaper-native-original-contract-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1, lightscaperNativePhotoOriginalBodyPathCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import type { LightscaperNativeOriginalBindingCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import type { LightscaperNativeOriginalBodyHeadCurrentV1 } from './lightscaper-native-original-body-head-current-v1.ts';
import type { CatalogOriginalInspectionOutcomeV1 } from '../src/common/editor/storage/media-catalog-original-inspection-repository.ts';

type Paths = ReturnType<typeof deriveLightscaperNativePhotoOriginalPathsCurrentV1>;
export type LightscaperNativeOriginalFileLocatorCurrentV1 = Pick<LightscaperNativeOriginalBodyHeadCurrentV1, 'contentSha256' | 'locatorId' | 'byteLength' | 'layout'>;
type Locator = LightscaperNativeOriginalFileLocatorCurrentV1;
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
type Stamp = Pick<BigIntStats, 'dev' | 'ino' | 'size' | 'mtimeNs' | 'ctimeNs'>;
const MAXIMUM_CACHED_IDENTITIES = 32;
const INSPECTION_RETIREMENT_FAILURES = new WeakSet<object>();

/** Exact source-owned witness; opaque borrower errors never acquire this mark. */
export function isLightscaperNativeOriginalInspectionRetirementFailureCurrentV1(value: unknown): boolean {
	return value !== null && typeof value === 'object' && INSPECTION_RETIREMENT_FAILURES.has(value);
}

/** Main-private files only; no caller filename or storage key becomes a path.
 * The owner serializes calls and joins them before closing its database. */
export class LightscaperNativeOriginalFilesCurrentV1 {
	readonly #paths: Paths;
	readonly #verified = new Map<string, Stamp>();
	readonly #openFile: typeof open;
	readonly #retirementFailures: unknown[] = [];
	readonly #unretiredHandles = new Set<FileHandle>();
	readonly #unretiredProducers = new Set<AsyncIterator<Uint8Array>>();
	constructor(paths: Paths, openFile: typeof open = open) { this.#paths = paths; this.#openFile = openFile; }

	async put(binding: LightscaperNativeOriginalBindingCurrentV1, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal, locator?: Locator, fresh = false): Promise<void> {
		this.#assertRetired(); check(signal);
		if (fresh) {
			// Exact repair may replace a positively absent managed body tree.
			// All parent/staging ownership remains required before creating it.
			for (const path of layout(this.#paths).filter(value => value !== this.#paths.bodiesRoot)) await realDirectory(path, false);
			try { await realDirectory(this.#paths.bodiesRoot, false); }
			catch (error) {
				if (!hasCode(error, 'ENOENT')) throw error;
				await realDirectory(this.#paths.bodiesRoot, true, path => this.#syncDirectory(path));
			}
		}
		await assertLayout(this.#paths);
		const target = locatorPath(this.#paths, binding, locator);
		await realDirectory(dirname(target), true, path => this.#syncDirectory(path));
		const stage = join(this.#paths.stagingRoot, `${randomUUID()}.part`);
		const output = await this.#openFile(stage, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
		let primary: unknown, failed = false, outputClosed = false, done = false, producerRetired = true;
		let iterator: AsyncIterator<Uint8Array> | undefined;
		try {
			const hash = createHash('sha256'); let offset = 0;
			iterator = chunks[Symbol.asyncIterator]();
			for (;;) {
				const item = await iterator.next();
				if (item.done === true) { done = true; break; }
				const borrowed = item.value;
				check(signal);
				if (!(borrowed instanceof Uint8Array) || borrowed.byteLength < 1 || borrowed.byteLength > CHUNK
					|| borrowed.byteLength > binding.byteLength - offset) throw new RangeError('Native Original stream chunk leaves its bounded body.');
				// Snapshot before any await: an upload producer may reuse its buffers.
				const bytes = Uint8Array.from(borrowed);
				hash.update(bytes);
				for (let written = 0; written < bytes.length;) {
					check(signal);
					const result = await output.write(bytes, written, bytes.length - written, offset + written);
					if (result.bytesWritten < 1) throw new Error('Native Original stage stopped accepting bytes.');
					written += result.bytesWritten;
				}
				offset += bytes.length;
			}
			check(signal);
			if (offset !== binding.byteLength || hash.digest('hex') !== binding.contentSha256) throw new Error('Native Original stream length or SHA-256 differs from its binding.');
			await output.sync();
			await this.#closeHandle(output); outputClosed = true;
			await assertLayout(this.#paths); await realDirectory(dirname(target), false);
			check(signal);
			try { await link(stage, target); }
			catch (error) { if (!hasCode(error, 'EEXIST') || fresh) throw error; }
			// Exclusive hard linking publishes one complete file. An existing
			// winner must authenticate; no rename/copy fallback can replace it.
			await this.verify(binding, signal, true, locator);
			await this.#syncDirectory(dirname(target));
		} catch (error) { failed = true; primary = error; }
		const cleanup: unknown[] = [];
		// Explicitly join return even when next() rejected. AsyncIteratorClose
		// can mask a return rejection behind a primary throw from a for-await body.
		if (iterator && !done) {
			try {
				const finish = iterator.return;
				if (finish) {
					const ended: unknown = await finish.call(iterator);
					if (!ended || typeof ended !== 'object' || Object.getOwnPropertyDescriptor(ended, 'done')?.value !== true) {
						throw new Error('Native Original producer return did not establish terminal retirement.');
					}
				}
			}
			catch (error) { producerRetired = false; this.#unretiredProducers.add(iterator); cleanup.push(error); this.#retirementFailures.push(error); }
		}
		if (!outputClosed) {
			try { await this.#closeHandle(output); outputClosed = true; }
			catch (error) { cleanup.push(error); }
		}
		if (outputClosed && producerRetired) {
			try { await unlink(stage); } catch (error) { if (!hasCode(error, 'ENOENT')) { cleanup.push(error); this.#retirementFailures.push(error); } }
		}
		if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native Original stage retirement failed.');
		if (failed) throw primary;
	}

	async verify(binding: LightscaperNativeOriginalBindingCurrentV1, signal?: AbortSignal, force = false, locator?: Locator): Promise<void> {
		const opened = await this.#open(binding, signal, force, locator);
		await this.#closeHandle(opened.handle);
	}

	/** Inspection always reads the full actual body, even after a cached verify.
	 * Only positive native ENOENT and stable size/digest mismatches are outcomes;
	 * layout, permission, changed-file and retirement failures remain errors. */
	async inspect(binding: LightscaperNativeOriginalBindingCurrentV1, signal?: AbortSignal, locator?: Locator): Promise<CatalogOriginalInspectionOutcomeV1> {
		this.#assertRetired(); inspectionCheck(signal);
		const path = locatorPath(this.#paths, binding, locator);
		this.#verified.delete(path);
		for (const required of layout(this.#paths).filter(value => value !== this.#paths.bodiesRoot)) await realDirectory(required, false);
		if (!await inspectionDirectories([this.#paths.bodiesRoot, dirname(path)])) {
			inspectionCheck(signal); return Object.freeze({ status: 'missing', reason: 'directory' });
		}
		let before: BigIntStats;
		try { before = await regularFile(path); }
		catch (error) {
			if (!hasCode(error, 'ENOENT')) throw error;
			inspectionCheck(signal); return Object.freeze({ status: 'missing', reason: 'file' });
		}
		const handle = await this.#openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		return this.#withHandle(handle, async () => {
			const opened = await handle.stat({ bigint: true });
			if (!opened.isFile() || !same(before, opened)) throw new Error('Native Original changed while opening for inspection.');
			let result: CatalogOriginalInspectionOutcomeV1;
			if (opened.size !== BigInt(binding.byteLength)) result = Object.freeze({ status: 'corrupt', reason: 'size' });
			else {
				const hash = createHash('sha256'), bytes = new Uint8Array(CHUNK);
				try {
					for (let offset = 0; offset < binding.byteLength;) {
						inspectionCheck(signal);
						const receipt = await handle.read(bytes, 0, Math.min(bytes.byteLength, binding.byteLength - offset), offset);
						if (receipt.bytesRead < 1) throw new Error('Native Original ended during inspection.');
						hash.update(bytes.subarray(0, receipt.bytesRead)); offset += receipt.bytesRead;
					}
					result = Object.freeze(hash.digest('hex') === binding.contentSha256 ? { status: 'present' } : { status: 'corrupt', reason: 'digest' });
				} finally { bytes.fill(0); }
			}
			inspectionCheck(signal); await assertLayout(this.#paths); await realDirectory(dirname(path), false);
			if (!same(opened, await handle.stat({ bigint: true })) || !same(opened, await regularFile(path))) throw new Error('Native Original changed during inspection.');
			inspectionCheck(signal); return result;
		}, true);
	}

	async read(binding: LightscaperNativeOriginalBindingCurrentV1, offset: number, length: number, signal?: AbortSignal, locator?: Locator): Promise<Uint8Array> {
		const { handle, stamp, path } = await this.#open(binding, signal, false, locator);
		return this.#withHandle(handle, async () => {
			try {
				const bytes = new Uint8Array(length); let read = 0;
				while (read < length) {
					check(signal);
					const value = await handle.read(bytes, read, length - read, offset + read);
					if (value.bytesRead < 1) throw new Error('Native Original ended during its bounded read.');
					read += value.bytesRead;
				}
				check(signal);
				if (!same(stamp, await handle.stat({ bigint: true })) || !same(stamp, await regularFile(path))) throw new Error('Native Original changed during its bounded read.');
				return bytes;
			} catch (error) { this.#verified.delete(path); throw error; }
		});
	}
	retirementUnproved(): boolean { return this.#retirementFailures.length > 0; }
	async syncIndexDirectory(): Promise<void> { this.#assertRetired(); await this.#syncDirectory(this.#paths.libraryRoot); }

	retire(): Promise<void> {
		this.#verified.clear();
		return this.#retirementFailures.length ? Promise.reject(new AggregateError([...this.#retirementFailures], 'Native Original file or producer retirement is unproved.')) : Promise.resolve();
	}
	#assertRetired(): void {
		if (this.#retirementFailures.length) throw new Error('Native Original owner is fenced after unproved retirement.');
	}
	async #closeHandle(handle: FileHandle): Promise<void> {
		try { await handle.close(); this.#unretiredHandles.delete(handle); }
		catch (error) { this.#unretiredHandles.add(handle); this.#retirementFailures.push(error); throw error; }
	}
	async #withHandle<T>(handle: FileHandle, run: () => Promise<T>, inspection = false): Promise<T> {
		const outcome = await Promise.resolve().then(run).then(value => ({ okay: true as const, value }), (error: unknown) => ({ okay: false as const, error }));
		try { await this.#closeHandle(handle); }
		catch (cleanup) {
			const failure = new AggregateError(outcome.okay ? [cleanup] : [outcome.error, cleanup], 'Native Original read and handle retirement failed.', { cause: cleanup });
			if (inspection) INSPECTION_RETIREMENT_FAILURES.add(failure);
			throw failure;
		}
		if (!outcome.okay) throw outcome.error;
		return outcome.value;
	}
	async #syncDirectory(path: string): Promise<void> {
		if (process.platform === 'win32') return;
		const directory = await this.#openFile(path, constants.O_RDONLY);
		await this.#withHandle(directory, () => directory.sync());
	}

	async #open(binding: LightscaperNativeOriginalBindingCurrentV1, signal?: AbortSignal, force = false, locator?: Locator): Promise<Readonly<{ handle: FileHandle; stamp: Stamp; path: string }>> {
		this.#assertRetired(); check(signal); await assertLayout(this.#paths);
		const path = locatorPath(this.#paths, binding, locator);
		await realDirectory(dirname(path), false);
		const before = await regularFile(path);
		if (before.size !== BigInt(binding.byteLength)) throw new Error('Native Original length differs from its binding.');
		const handle = await this.#openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		try {
			const opened = await handle.stat({ bigint: true });
			if (!opened.isFile() || !same(before, opened)) throw new Error('Native Original changed while opening.');
			const cached = this.#verified.get(path);
			if (force || !cached || !same(cached, opened)) {
				const hash = createHash('sha256'), bytes = new Uint8Array(CHUNK);
				for (let offset = 0; offset < binding.byteLength;) {
					check(signal);
					const length = Math.min(bytes.length, binding.byteLength - offset);
					const result = await handle.read(bytes, 0, length, offset);
					if (result.bytesRead < 1) throw new Error('Native Original ended while authenticating its bytes.');
					hash.update(bytes.subarray(0, result.bytesRead)); offset += result.bytesRead;
				}
				if (hash.digest('hex') !== binding.contentSha256) throw new Error('Native Original SHA-256 differs from its binding.');
			}
			check(signal);
			const after = await handle.stat({ bigint: true });
			if (!same(opened, after) || !same(after, await regularFile(path))) throw new Error('Native Original changed during authentication.');
			this.#verified.delete(path); this.#verified.set(path, after);
			while (this.#verified.size > MAXIMUM_CACHED_IDENTITIES) this.#verified.delete(this.#verified.keys().next().value!);
			return { handle, stamp: after, path };
		} catch (error) {
			this.#verified.delete(path);
			try { await this.#closeHandle(handle); }
			catch (cleanup) { throw new AggregateError([error, cleanup], 'Native Original authentication and handle retirement failed.', { cause: cleanup }); }
			throw error;
		}
	}
}

export async function prepareLightscaperNativeOriginalStorageCurrentV1(appDataPath: string): Promise<Paths> {
	// The host supplies a canonical private appData root, never a renderer path.
	await realDirectory(appDataPath, false);
	const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath);
	for (const path of layout(paths)) await realDirectory(path, true);
	for (const suffix of ['', '-wal', '-shm', '-journal']) {
		try { const file = await regularFile(paths.databasePath + suffix); if (file.nlink !== 1n) throw new Error('Native Original database cannot use hard-link aliases.'); }
		catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
	}
	return paths;
}

function layout(paths: Paths): readonly string[] {
	return [resolve(paths.libraryRoot, '../..'), dirname(paths.libraryRoot), paths.libraryRoot, paths.bodiesRoot, paths.stagingRoot];
}
async function assertLayout(paths: Paths): Promise<void> { for (const path of layout(paths)) await realDirectory(path, false); }
async function realDirectory(path: string, create: boolean, sync: (path: string) => Promise<void> = syncDirectory): Promise<void> {
	if (create) { try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; } }
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) throw new Error('Native Original storage requires canonical real directories.');
	if (create) await chmod(path, 0o700);
	// EEXIST can follow an interrupted or failed prior parent sync. Admission
	// must settle that durability debt before this attempt publishes authority.
	if (create) await sync(dirname(path));
}
async function regularFile(path: string): Promise<BigIntStats> {
	const metadata = await lstat(path, { bigint: true });
	if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== path) throw new Error('Native Original storage requires canonical regular files.');
	return metadata;
}
async function syncDirectory(path: string): Promise<void> {
	// Node cannot portably FlushFileBuffers a Windows directory. Byte fsync and
	// SQLite FULL remain required there; power-loss durability is not claimed.
	if (process.platform === 'win32') return;
	const directory = await open(path, constants.O_RDONLY);
	try { await directory.sync(); } finally { await directory.close(); }
}
function same(left: Stamp, right: Stamp): boolean {
	return left.dev === right.dev && left.ino === right.ino && left.size === right.size
		&& left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function hasCode(error: unknown, code: string): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === code; }

const INSPECTION_CHECK = AbortSignal.prototype.throwIfAborted;
function inspectionCheck(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(INSPECTION_CHECK, signal, []); }
async function inspectionDirectories(paths: readonly string[]): Promise<boolean> {
	for (const path of paths) {
		try { await realDirectory(path, false); }
		catch (error) { if (hasCode(error, 'ENOENT')) return false; throw error; }
	}
	return true;
}

/** Fixed private derivation; no caller path or fallback after a chosen head. */
function locatorPath(paths: Paths, binding: LightscaperNativeOriginalBindingCurrentV1, locator?: Locator): string {
	if (!locator) return lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, binding.contentSha256);
	if (locator.contentSha256 !== binding.contentSha256 || locator.byteLength !== binding.byteLength) throw new Error('Native Original locator contradicts its physical binding.');
	if (locator.layout === 'legacy-sha-v1' && locator.locatorId === 'legacy') return lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, binding.contentSha256);
	if (locator.layout !== 'generation-v1' || !/^[a-f0-9]{64}$/u.test(locator.locatorId)) throw new TypeError('Native Original locator is malformed.');
	return join(paths.bodiesRoot, binding.contentSha256.slice(0, 2), `${binding.contentSha256}.${locator.locatorId}.body`);
}
