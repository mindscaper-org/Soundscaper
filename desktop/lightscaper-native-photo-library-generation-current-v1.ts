/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, open, realpath, readdir, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { PhotoLibraryRestoreAllocationV1 as Allocation } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted, MAXIMUM = 4096;
type Stamp = Pick<BigIntStats, 'dev' | 'ino' | 'size' | 'mtimeNs' | 'ctimeNs'>;
export function lightscaperNativePhotoLibraryManifestCurrentV1(registryOwner: string, allocation: Readonly<Allocation>): Readonly<{ text: string; sha256: string }> {
	const text = JSON.stringify({ schemaVersion: 1, kind: 'native-photo-library-generation', storageProfile: 'lightscaper-native-photo-v1', registryOwner, allocation });
	if (Buffer.byteLength(text, 'utf8') > MAXIMUM) throw new RangeError('Native generation manifest exceeds its byte limit.');
	return Object.freeze({ text, sha256: createHash('sha256').update(text).digest('hex') });
}

/** Caller owns a durable reservation before this first exclusive directory
 * creation. No component may write in app-data until created SQL commits. */
export async function createLightscaperNativePhotoLibraryGenerationCurrentV1(libraryRoot: string, owner: string,
	allocation: Readonly<Allocation>, signal?: AbortSignal): Promise<string> {
	check(signal); const parent = join(libraryRoot, 'native-photo-libraries'); await directory(parent, true); await syncDirectory(libraryRoot); check(signal);
	const generation = join(parent, allocation.namespaceToken); await mkdir(generation, { mode: 0o700 }); check(signal);
	await directory(generation, false); await syncDirectory(parent); check(signal);
	return complete(generation, lightscaperNativePhotoLibraryManifestCurrentV1(owner, allocation).text, 'reserved', signal);
}

/** Reserved crash recovery admits only exact fresh inventory with empty
 * app-data. Created generations must already have both immutable components.
 * No failure, marker or matching token grants deletion authority. */
export async function resumeLightscaperNativePhotoLibraryGenerationCurrentV1(libraryRoot: string, owner: string,
	allocation: Readonly<Allocation>, state: 'reserved' | 'created', signal?: AbortSignal): Promise<string> {
	check(signal); const parent = join(libraryRoot, 'native-photo-libraries'); await directory(parent, state === 'reserved');
	if (state === 'reserved') await syncDirectory(libraryRoot); check(signal);
	const generation = join(parent, allocation.namespaceToken);
	if (state === 'reserved') {
		try { await mkdir(generation, { mode: 0o700 }); await syncDirectory(parent); }
		catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
	}
	await directory(generation, false); check(signal);
	return complete(generation, lightscaperNativePhotoLibraryManifestCurrentV1(owner, allocation).text, state, signal);
}
async function complete(generation: string, expected: string, state: 'reserved' | 'created', signal?: AbortSignal): Promise<string> {
	const names = await readdir(generation); check(signal);
	if (names.some(name => name !== 'app-data' && name !== 'owner.json')) throw new Error('Native generation has foreign inventory.');
	const appData = join(generation, 'app-data'), manifest = join(generation, 'owner.json');
	if (state === 'created' && (!names.includes('app-data') || !names.includes('owner.json'))) throw new Error('Created native generation is incomplete.');
	if (names.includes('app-data')) {
		await directory(appData, false); check(signal);
		if (state === 'reserved' && (await readdir(appData)).length !== 0) throw new Error('Reserved native generation appData is not fresh.');
	}
	if (names.includes('owner.json')) await readManifest(manifest, expected);
	else {
		check(signal); const handle = await open(manifest, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
		await withHandle(handle, async () => { await handle.writeFile(expected, 'utf8'); await handle.sync(); });
		await readManifest(manifest, expected);
	}
	check(signal);
	if (!names.includes('app-data')) { await mkdir(appData, { mode: 0o700 }); await directory(appData, false); }
	await syncDirectory(appData); await syncDirectory(generation); check(signal); return appData;
}
async function readManifest(path: string, expected: string): Promise<void> {
	const before = await regular(path);
	if (before.size > BigInt(MAXIMUM)) throw new RangeError('Native generation manifest exceeds its byte limit.');
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	await withHandle(handle, async () => {
		const opened = await handle.stat({ bigint: true }); if (!same(before, opened) || !opened.isFile()) throw new Error('Native generation manifest changed while opening.');
		const bytes = new Uint8Array(MAXIMUM + 1); let offset = 0;
		for (;;) {
			const result = await handle.read(bytes, offset, bytes.length - offset, offset); offset += result.bytesRead;
			if (offset > MAXIMUM) throw new RangeError('Native generation manifest exceeds its byte limit.');
			if (result.bytesRead === 0) break;
		}
		const expectedBytes = Buffer.from(expected, 'utf8');
		if (offset !== expectedBytes.byteLength || !expectedBytes.every((byte, index) => bytes[index] === byte)
			|| !same(opened, await handle.stat({ bigint: true })) || !same(opened, await regular(path))) throw new Error('Native generation manifest differs from its actual registry reservation.');
	});
}
async function regular(path: string): Promise<BigIntStats> {
	const entry = await lstat(path, { bigint: true });
	if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1n || await realpath(path) !== path) throw new TypeError('Native generation manifest requires a canonical single-link regular file.');
	return entry;
}
async function directory(path: string, create: boolean): Promise<void> {
	if (create) { try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; } }
	const entry = await lstat(path);
	if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path) throw new TypeError('Native generation requires canonical real directories.');
}
async function syncDirectory(path: string): Promise<void> {
	if (process.platform === 'win32') return;
	const handle = await open(path, constants.O_RDONLY); await withHandle(handle, () => handle.sync());
}
async function withHandle(handle: FileHandle, run: () => Promise<void>): Promise<void> {
	let failed = false, primary: unknown;
	try { await run(); } catch (error) { failed = true; primary = error; }
	try { await handle.close(); }
	catch (cleanup) { throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Native generation file retirement failed.', { cause: cleanup }); }
	if (failed) throw primary;
}
function same(left: Stamp, right: Stamp): boolean { return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs; }
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
function hasCode(error: unknown, code: string): boolean { return error !== null && typeof error === 'object' && 'code' in error && error.code === code; }
