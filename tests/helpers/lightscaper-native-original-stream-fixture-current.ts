/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LightscaperNativeOriginalStoreCurrentV1 as Originals } from '../../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 } from '../../desktop/lightscaper-native-original-index-current-v1.ts';

export const MiB = 1024 * 1024;
export const streamBindingCurrentV1 = (bytes: Uint8Array, storageKey = 'streamed-original') => Object.freeze({
	storageKey, byteLength: bytes.byteLength, contentSha256: createHash('sha256').update(bytes).digest('hex'),
});
export type NativeStreamFixtureCurrentV1 = Readonly<{
	appDataPath: string; originals: Originals; db: DatabaseSync;
	paths: ReturnType<typeof deriveLightscaperNativePhotoOriginalPathsCurrentV1>;
	own: <T extends { abort(): Promise<void> }>(value: T) => T;
}>;
export async function nativeStreamFixtureCurrentV1(run: (fixture: NativeStreamFixtureCurrentV1) => Promise<void>): Promise<void> {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper native original stream '));
	const streams: Array<{ abort(): Promise<void> }> = [];
	let originals: Originals | undefined, db: DatabaseSync | undefined, primary: unknown, failed = false;
	try {
		originals = await Originals.open({ appDataPath });
		const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath); db = new DatabaseSync(paths.databasePath);
		await run({ appDataPath, originals, db, paths, own: value => { streams.push(value); return value; } });
	} catch (error) { failed = true; primary = error; }
	// Join each stream even when its observed operation failed. OriginalStore.close
	// is the actual authoritative file/producer retirement witness before removal.
	await Promise.allSettled(streams.map(stream => stream.abort()));
	const retired = await Promise.allSettled([originals?.close(), Promise.resolve().then(() => { db?.close(); })]);
	const cleanup = retired.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native stream fixture retained after failed actual retirement.');
	await rm(appDataPath, { recursive: true, force: true }); if (failed) throw primary;
}

type WriteResult = { bytesWritten: number; buffer: Uint8Array };
export type NativeFileProbeCurrentV1 = Readonly<{
	write?: (actual: () => Promise<WriteResult>, bytes: Uint8Array, length: number) => Promise<WriteResult>;
}>;
/** Instruments genuine FileHandle operations; never substitutes a file/store. */
export async function probeNativeStreamFilesCurrentV1(appDataPath: string, probe: NativeFileProbeCurrentV1, run: () => Promise<void>): Promise<void> {
	const scratch = join(appDataPath, 'native-file-prototype-probe');
	const handle = await open(scratch, 'w+'); const prototype: object = Object.getPrototypeOf(handle) as object;
	await handle.close(); await rm(scratch);
	const write = Object.getOwnPropertyDescriptor(prototype, 'write')!;
	try {
		if (probe.write) Object.defineProperty(prototype, 'write', { ...write, value: function (this: FileHandle, bytes: Uint8Array, offset: number, length: number, position: number) {
			const actual = (): Promise<WriteResult> => Reflect.apply(write.value as FileHandle['write'], this, [bytes, offset, length, position]) as Promise<WriteResult>;
			return probe.write!(actual, bytes, length);
		} });
		await run();
	} finally { Object.defineProperty(prototype, 'write', write); }
}
export function opaqueStreamFailureCurrentV1(): object {
	return new Proxy(Object.freeze({}), { get() { throw new Error('Opaque abort reason was inspected.'); }, getPrototypeOf() { throw new Error('Opaque abort prototype was inspected.'); } });
}
export async function exactStreamFailureCurrentV1(work: Promise<unknown>, expected: unknown): Promise<void> {
	await work.then(() => { throw new Error('Expected the exact failure.'); }, (reason: unknown) => { if (reason !== expected) throw new Error('Exact first failure was replaced.'); });
}
