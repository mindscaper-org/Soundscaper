/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { LightscaperNativeOriginalStoreCurrentV1 as Store,
	consumeLightscaperNativeOriginalRepairPublicationCurrentV1 as consume,
	retireLightscaperNativeOriginalRepairPublicationCurrentV1 as retire,
	type LightscaperNativeOriginalBindingReadCurrentV1 as Lease } from '../../desktop/lightscaper-native-original-store-current-v1.ts';
import { readLightscaperNativeOriginalBodyHeadCurrentV1 as readHead,
	switchLightscaperNativeOriginalBodyHeadCurrentV1 as switchHead } from '../../desktop/lightscaper-native-original-body-head-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths,
	lightscaperNativePhotoOriginalBodyPathCurrentV1 as bodyPath } from '../../desktop/lightscaper-native-original-index-current-v1.ts';
import { deferred } from './async-test-control.ts';
export { assert, consume, retire, readHead, switchHead, Store };
export const GENERATION_OPTIONS_CURRENT_V1 = { concurrency: false, timeout: 15_000 };
export function digestCurrentV1(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export async function* generationChunksCurrentV1(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
	for (let offset = 0; offset < bytes.byteLength; offset += 1024 * 1024) yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + 1024 * 1024));
}
export async function nativeOriginalGenerationFixtureCurrentV1(context: TestContext,
	run: (fixture: Readonly<{ appDataPath: string; store: Store; db: DatabaseSync; bytes: Uint8Array; path: string;
	binding: Readonly<{ storageKey: string; byteLength: number; contentSha256: string }>; signal: AbortSignal;
	track<T>(work: Promise<T>): Promise<T>; lease(): Lease; repair(): Promise<void>;
	hold<T>(run: (gate: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<T>): Promise<T>;
	}>) => Promise<void>): Promise<void> {
	const stop = new AbortController(), active = new Set<Promise<unknown>>(), leases = new Set<Lease>(), releases = new Set<() => void>();
	const cancel = (): void => { for (const release of releases) release(); stop.abort(context.signal.reason); };
	context.signal.addEventListener('abort', cancel, { once: true });
	let appDataPath: string | undefined, store: Store | undefined, db: DatabaseSync | undefined, failed = false, primary: unknown;
	const track = <T>(work: Promise<T>): Promise<T> => { active.add(work); void work.then(() => active.delete(work), () => active.delete(work)); return work; };
	try {
	 appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper-original-generations-'));
	 store = await Store.open({ appDataPath }); const actual = store;
	 const bytes = new TextEncoder().encode('actual immutable Original generation Ω\n'.repeat(257));
	 const binding = Object.freeze({ storageKey: 'asset', byteLength: bytes.byteLength, contentSha256: digestCurrentV1(bytes) });
	 await store.storeBinding(binding, generationChunksCurrentV1(bytes));
	 db = new DatabaseSync(paths(appDataPath).databasePath); db.exec('PRAGMA foreign_keys=ON'); const database = db;
	 const path = bodyPath(paths(appDataPath), binding.contentSha256);
	 if (context.signal.aborted) cancel(); context.signal.throwIfAborted();
	 await run({ appDataPath, store, db, bytes, binding, path, signal: stop.signal, track,
	  lease: (): Lease => { const lease = actual.acquireBindingRead(binding); leases.add(lease); return lease; },
	  repair: async (): Promise<void> => {
	   const expectedHead = readHead(database, binding);
	   const proof = await actual.prepareRepairBinding(binding, generationChunksCurrentV1(bytes), { signal: stop.signal, expectedHead });
	   try { database.exec('BEGIN IMMEDIATE'); const captured = consume(proof, database); switchHead(database, captured.binding, captured.expectedHead, captured.locatorId); database.exec('COMMIT'); }
	   catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
	   finally { retire(proof); }
	  },
	  hold: async <T>(consumeHeld: (gate: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<T>): Promise<T> => {
	   const witness = await open(path, 'r'), stamp = await witness.stat({ bigint: true });
	   const prototype = Object.getPrototypeOf(witness) as object, descriptor = Object.getOwnPropertyDescriptor(prototype, 'read');
	   assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as FileHandle['read']; await witness.close();
	   const entered = deferred<void>(), released = deferred<void>(); let held = false;
	   const release = (): void => { entered.resolve(); released.resolve(); }; releases.add(release);
	   Object.defineProperty(prototype, 'read', { ...descriptor, value: function (this: FileHandle, ...args: unknown[]) {
	    const receipt = Reflect.apply(native, this, args) as ReturnType<FileHandle['read']>;
	    return receipt.then(async value => { const actualStamp = await this.stat({ bigint: true });
	     if (!held && actualStamp.dev === stamp.dev && actualStamp.ino === stamp.ino) { held = true; entered.resolve(); await released.promise; } return value; });
	   } });
	   if (context.signal.aborted) release();
	   try { return await consumeHeld({ entered: entered.promise, release }); }
	   finally { release(); await Promise.allSettled([...active]); releases.delete(release); Object.defineProperty(prototype, 'read', descriptor); }
	  },
	 });
	} catch (error) { failed = true; primary = error; }
	context.signal.removeEventListener('abort', cancel); for (const release of releases) release(); stop.abort(new Error('Generation fixture closing.'));
	await Promise.allSettled([...active]); const cleanup: unknown[] = [];
	for (const lease of leases) { try { await lease.close(); } catch (error) { cleanup.push(error); } }
	try { await store?.close(); } catch (error) { cleanup.push(error); }
	try { db?.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Generation fixture retirement failed; physical files retained.');
	if (appDataPath) await rm(appDataPath, { recursive: true, force: true }); if (failed) throw primary;
}
