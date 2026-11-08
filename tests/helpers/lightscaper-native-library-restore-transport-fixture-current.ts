/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoLibraryRestoreServiceCurrentV1 as Service } from '../../desktop/lightscaper-native-photo-library-restore-service-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_RESTORE_CHANNELS_CURRENT_V1 as CHANNELS } from '../../src/lightscaper/desktop-photo-library-restore-contract-current-v1.ts';
import { nativeArchiveRestoreTargetCurrentV1 as target } from './lightscaper-native-library-archive-restore-fixture-current.ts';

export async function nativeRestoreTransportFixtureCurrentV1(context: TestContext, run: (f: Awaited<ReturnType<typeof make>>) => Promise<void>): Promise<void> {
	await target(context, async base => {
	const f = await make(base, context); let failed = false, primary: unknown;
	try { await run(f); } catch (error) { failed = true; primary = error; }
	try { await f.close(); } catch (cleanup) { if (failed) throw new AggregateError([primary, cleanup], 'Transport fixture retirement failed.', { cause: cleanup }); throw cleanup; }
	if (failed) throw primary;
	});
}
async function make(base: Parameters<Parameters<typeof target>[1]>[0], context: TestContext) {
	const service = new Service(base.scopes, base.directory), owner = Object.freeze({}), tasks = new Set<Promise<unknown>>();
	const stop = (): void => { void service.closeAll().catch(() => undefined); }; context.signal.addEventListener('abort', stop, { once: true });
	const directory = join(base.directory, 'Lightscaper', 'project-library', 'v1', 'native-photo-library-restore-staging');
	const invoke = (channel: string, packet: unknown): Promise<unknown> => {
	if (channel === CHANNELS.begin) return service.begin(owner, packet);
	if (channel === CHANNELS.write) return service.write(owner, packet);
	if (channel === CHANNELS.commit) return service.commit(owner, packet);
	if (channel === CHANNELS.abort) return service.abort(owner, packet);
	return Promise.reject(new Error('Unknown test transport channel.'));
	};
	return { ...base, get scopes() { return base.scopes; }, directory, appDataPath: base.directory, service, owner, transport: Object.freeze({ invoke }),
	track<T>(work: Promise<T>): Promise<T> { tasks.add(work); void work.then(() => tasks.delete(work), () => tasks.delete(work)); return work; },
	async files(): Promise<readonly string[]> { try { return await readdir(directory); } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []; throw error; } },
	async close(): Promise<void> { for (const task of tasks) void task.catch(() => undefined); await service.closeAll(); await Promise.allSettled([...tasks]); context.signal.removeEventListener('abort', stop); },
	};
}
export const archiveTransportShaCurrentV1 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export async function holdRestoreFileReadCurrentV1<T>(f: Parameters<Parameters<typeof nativeRestoreTransportFixtureCurrentV1>[1]>[0], run: (gate: { entered: Promise<void>; release(): void }) => Promise<T>): Promise<T> {
	const handle = await open(join(f.appDataPath, 'read-prototype-probe'), 'w', 0o600), prototype = Object.getPrototypeOf(handle) as FileHandle; await handle.close();
	const actual = prototype.read, entered = f.gate(), leave = f.gate(); let held = false;
	prototype.read = function(this: FileHandle, ...args: unknown[]) { if (!held) { held = true; entered.release(); return leave.promise.then(() => Reflect.apply(actual, this, args)); } return Reflect.apply(actual, this, args); } as FileHandle['read'];
	try { return await run({ entered: entered.promise, release: leave.release }); }
	finally { leave.release(); await Promise.allSettled([]); prototype.read = actual; }
}
export async function uploadRestoreFixtureCurrentV1(f: Parameters<Parameters<typeof nativeRestoreTransportFixtureCurrentV1>[1]>[0], bytes: Uint8Array) {
	const opened = await f.service.begin(f.owner, { name: 'Native restored', byteLength: bytes.byteLength });
	for (let offset = 0; offset < bytes.byteLength; offset += 1_048_576) await f.service.write(f.owner, { id: opened.id, offset, bytes: bytes.subarray(offset, offset + 1_048_576) });
	return { id: opened.id, contentSha256: archiveTransportShaCurrentV1(bytes) };
}
export async function loadRestoreRuntimeCurrentV1() {
	const url = new URL('../../src/lightscaper/desktop-photo-library-restore-runtime-current-v1.ts', import.meta.url); url.searchParams.set('fixture', String(++serial));
	return await import(url.href) as typeof import('../../src/lightscaper/desktop-photo-library-restore-runtime-current-v1.ts');
}
let serial = 0;
export function assertRestoreNoticeCurrentV1(value: readonly string[]): void { assert.ok(value.every(notice => notice === 'cleanup-failed' || notice === 'publication-reconciled')); }
