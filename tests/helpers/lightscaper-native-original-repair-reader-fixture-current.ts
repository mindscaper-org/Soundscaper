/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { open, readFile, readdir, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { LightscaperNativeOriginalStoreCurrentV1 as Store } from '../../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1, lightscaperNativePhotoOriginalBodyPathCurrentV1 } from '../../desktop/lightscaper-native-original-index-current-v1.ts';
import type { CatalogOriginalRepairReceiptV1 } from '../../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import { fixture, test, readTicket, readGroup, groupTransport, seedAliases, releaseAliases, deferred, remainsPending, sha as hashBytes,
	holdRead, check, exactFailure, Media, type Fixture, type Request } from './lightscaper-native-original-group-fixture-current.ts';
export { fixture, test, readTicket, readGroup, groupTransport, seedAliases, releaseAliases, deferred, remainsPending, holdRead, check, exactFailure, Store, Media };
export type { Fixture, Request };

/** Transport bytes remain unknown until their actual runtime brand is checked. */
export function sha(value: unknown): string {
	assert.ok(value instanceof Uint8Array, 'Actual native ticket read must return Uint8Array bytes.');
	return hashBytes(value);
}

/** This assertion follows actual FS/SQLite asset/catalog publication. Reflection
 * permits genuine missing-method RED on the E91 class, not a module bootstrap. */
export async function requirePhysicalReadCurrentV1(f: Fixture): Promise<void> {
	const store = await Store.open({ appDataPath: f.appDataPath });
	try { assert.equal(typeof Reflect.get(store, 'acquireBindingRead'), 'function', 'Actual OriginalStore must vend a whole-consumer physical lease.'); }
	finally { await store.close(); }
}
export function repairReaderBodyCurrentV1(f: Fixture, request: Readonly<Request> = f.request, importId: string | null = null, media: Fixture['media'] = f.media, signal?: AbortSignal): Promise<Readonly<CatalogOriginalRepairReceiptV1>> {
	const method: unknown = Reflect.get(media, 'restoreCatalogOriginalBody');
	assert.equal(typeof method, 'function', 'Actual native Media must expose exact retained-body repair.');
	const original = request.original;
	return Reflect.apply(method as (...args: unknown[]) => Promise<Readonly<CatalogOriginalRepairReceiptV1>>, media,
		[{ catalogId: request.catalogId, importId, photoId: request.photoId, assetId: original.storageKey, sourceId: original.id,
			sha256: original.contentSha256, size: original.byteLength, name: original.name, mimeType: original.mimeType }, new Blob([f.entry.bytes]), signal ? { signal } : {}]);
}
/** A second genuine native owner supplies WAL concurrency while the first
 * Media publication queue is intentionally held by an actual read. */
export async function withRepairReaderPeerCurrentV1(f: Fixture, run: (peer: Fixture['media']) => Promise<void>): Promise<void> {
	const peer = await Media.open({ appDataPath: f.appDataPath }); let failed = false, primary: unknown;
	try { await run(peer); } catch (error) { failed = true; primary = error; }
	try { await peer.close(); } catch (cleanup) { throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Repair reader peer did not retire; native evidence retained.', { cause: cleanup }); }
	if (failed) throw primary;
}
export function legacyReaderPathCurrentV1(f: Fixture): string {
	assert.ok(f.request.original.contentSha256);
	return lightscaperNativePhotoOriginalBodyPathCurrentV1(deriveLightscaperNativePhotoOriginalPathsCurrentV1(f.appDataPath), f.request.original.contentSha256);
}
/** Only the tiny newly-owned fixture shard is walked; diagnostics retain hashes
 * and inode scalars rather than large Buffer diffs or arbitrary path authority. */
export async function readerBodyFilesCurrentV1(f: Fixture): Promise<ReadonlyMap<string, string>> {
	const root = deriveLightscaperNativePhotoOriginalPathsCurrentV1(f.appDataPath).bodiesRoot;
	const pending = [root], result = new Map<string, string>(); let visited = 0;
	while (pending.length) {
		const directory = pending.shift()!;
		for (const item of await readdir(directory, { withFileTypes: true })) {
			if (++visited > 64) throw new Error('Unexpected fixture body inventory growth.');
			const path = join(directory, item.name);
			if (item.isDirectory()) pending.push(path);
			else { assert.equal(item.isFile(), true); result.set(path, sha(new Uint8Array(await readFile(path)))); }
		}
	}
	return result;
}
export async function assertFreshReaderGenerationCurrentV1(f: Fixture, before: ReadonlyMap<string, string>): Promise<void> {
	const after = await readerBodyFilesCurrentV1(f), added = [...after.keys()].filter(path => !before.has(path));
	assert.equal(added.length, 1, 'Repair must publish one fresh actual body.');
	assert.equal(after.get(added[0]!), sha(f.entry.bytes));
	const old = await stat(legacyReaderPathCurrentV1(f), { bigint: true }), next = await stat(added[0]!, { bigint: true });
	assert.equal(old.dev === next.dev && old.ino === next.ino, false, 'Repair must preserve the old inode and publish a new one.');
	for (const [path, digest] of before) assert.equal(after.get(path), digest, 'No existing locator may be replaced.');
}
export async function corruptLegacyReaderBodyCurrentV1(f: Fixture): Promise<void> {
	const wrong = f.entry.bytes.slice(); wrong[wrong.length - 1] = wrong[wrong.length - 1]! ^ 1;
	try { await writeFile(legacyReaderPathCurrentV1(f), wrong); } finally { wrong.fill(0); }
}
export function readerLogicalSnapshotCurrentV1(f: Fixture): string {
	return JSON.stringify({ assets: f.database.prepare('SELECT source_id,sha256,size,media_content_token,root_count FROM native_photo_media_assets ORDER BY source_id').all(),
		bindings: f.database.prepare('SELECT storage_key,content_sha256,byte_length FROM native_photo_original_bindings ORDER BY storage_key').all(),
		roots: f.database.prepare('SELECT root FROM native_photo_media_roots ORDER BY root_key').all() });
}

/** Observe a genuine body FileHandle.read, then hold that exact handle's native
 * close BEFORE closing the FD. Native bytes and all file operations are real. */
export async function holdRepairReaderCloseCurrentV1<Result>(directory: string,
	run: (gate: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<Result>): Promise<Result> {
	const witness = await open(join(directory, 'repair-reader-close-witness'), 'wx');
	const prototype = Object.getPrototypeOf(witness) as object, descriptor = Object.getOwnPropertyDescriptor(prototype, 'read');
	assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as FileHandle['read']; await witness.close();
	const entered = deferred(), release = deferred();
	type State = { descriptor: PropertyDescriptor | undefined; close: FileHandle['close']; pending?: Promise<void> };
	const states = new WeakMap<FileHandle, State>(), handles: FileHandle[] = []; let selected = false;
	Object.defineProperty(prototype, 'read', { ...descriptor, value: function (this: FileHandle, ...args: unknown[]) {
		if (!selected) {
			selected = true; states.set(this, { descriptor: Object.getOwnPropertyDescriptor(this, 'close'), close: this.close }); handles.push(this);
			Object.defineProperty(this, 'close', { configurable: true, writable: true, value: function (this: FileHandle): Promise<void> {
				const state = states.get(this)!;
				state.pending ??= (async () => { entered.resolve(); await release.promise; await Reflect.apply(state.close, this, []); })();
				return state.pending;
			} });
		}
		return Reflect.apply(native, this, args) as ReturnType<FileHandle['read']>;
	} });
	try { return await run({ entered: entered.promise, release: () => { release.resolve(); } }); }
	finally {
		release.resolve(); await Promise.allSettled(handles.flatMap(handle => states.get(handle)?.pending ? [states.get(handle)!.pending!] : []));
		for (const handle of handles) { const state = states.get(handle)!; if (state.descriptor) Object.defineProperty(handle, 'close', state.descriptor); else Reflect.deleteProperty(handle, 'close'); }
		Object.defineProperty(prototype, 'read', descriptor);
	}
}
