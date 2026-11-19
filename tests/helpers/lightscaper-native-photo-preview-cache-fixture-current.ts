/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 } from '../../desktop/lightscaper-native-original-index-current-v1.ts';
import type { LightscaperNativePhotoPreviewCacheCurrentV1 as Cache } from '../../desktop/lightscaper-native-photo-preview-cache-current-v1.ts';
import type { BinaryDerivativeCacheProfileV1 as Profile } from '../../src/common/editor/storage/binary-derivative-cache-records.ts';
import { deferred } from './async-test-control.ts';

const BYTES = Blob.prototype.arrayBuffer;
let read: ((body: Blob) => Promise<void>) | null = null;
export const nativePreviewProfileCurrentV1 = (changes: Partial<Profile> = {}): Profile => ({ kind: 'photo-preview-cache', keyPrefix: 'photo-preview-sha256:',
	maximumBytes: 134217728, maximumEntries: 1024, maximumManifestBytes: 4096, maximumEvictions: 16, ...changes });
export const nativePreviewDigestCurrentV1 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function nativePreviewCacheFixtureCurrentV1(context: TestContext, run: (f: {
	appDataPath: string; cachePath: string; owner: Cache; media: Media; db: DatabaseSync; source: DatabaseSync;
	open(): Promise<Cache>; identity(name: string, size: number): { schemaVersion: 1; kind: string; key: string; sourceId: string; originalSha256: string; originalByteLength: number; recipeId: string; recipeVersion: number; byteLength: number; metadata: string };
	onBlobRead(run: ((body: Blob) => Promise<void>) | null): void; gate(): ReturnType<typeof deferred<void>>;
	track<T>(work: Promise<T>): Promise<T>; reached(entered: Promise<void>, work: Promise<unknown>): Promise<void>;
}) => Promise<void>): Promise<void> {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper-native-preview-cache-'));
	const owners: Cache[] = [], work = new Set<Promise<unknown>>(), releases = new Set<() => void>();
	let media: Media | undefined, db: DatabaseSync | undefined, source: DatabaseSync | undefined;
	read = null; let failed = false, primary: unknown;
	Blob.prototype.arrayBuffer = async function () { const result = await Reflect.apply(BYTES, this, []) as ArrayBuffer; await read?.(this); return result; };
	const cancel = (): void => { for (const release of releases) release(); for (const owner of owners) void owner.close().catch(() => undefined); };
	context.signal.addEventListener('abort', cancel, { once: true });
	try {
		const { LightscaperNativePhotoMediaCurrentV1: MediaOwner } = await import('../../desktop/lightscaper-native-photo-media-current-v1.ts');
		media = await MediaOwner.open({ appDataPath });
		const original = new Blob(['actual retained native Original']);
		await media.writeAsset('asset', original, { name: 'Original.png', mimeType: 'image/png' });
		source = new DatabaseSync(deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).databasePath);
		const imported: unknown = await import(new URL(`../../desktop/lightscaper-native-photo-preview-cache-current-v1.ts?fixture=${randomUUID()}`, import.meta.url).href);
		const Owner = (imported as typeof import('../../desktop/lightscaper-native-photo-preview-cache-current-v1.ts')).LightscaperNativePhotoPreviewCacheCurrentV1;
		const open = async (): Promise<Cache> => { const owner = await Owner.open({ appDataPath }); owners.push(owner); if (context.signal.aborted) await owner.close(); return owner; };
		const owner = await open(), cachePath = join(appDataPath, 'Lightscaper', 'project-library', 'v1', 'native-photo-preview-cache.sqlite3');
		db = new DatabaseSync(cachePath); db.exec('PRAGMA foreign_keys=ON');
		const track = <T>(pending: Promise<T>): Promise<T> => { work.add(pending); void pending.then(() => { work.delete(pending); }, () => { work.delete(pending); }); return pending; };
		await run({ appDataPath, cachePath, owner, media, db, source, open,
			identity: (name, size) => ({ schemaVersion: 1, kind: 'photo-preview-cache', key: `photo-preview-sha256:${name}`, sourceId: 'asset',
				originalSha256: nativePreviewDigestCurrentV1('actual retained native Original'), originalByteLength: original.size,
				recipeId: `lightscaper.recipe.${name}`, recipeVersion: 1, byteLength: size, metadata: JSON.stringify({ name }) }),
			onBlobRead: callback => { read = callback; }, gate: () => { const gate = deferred<void>(); releases.add(() => { gate.resolve(); }); if (context.signal.aborted) gate.resolve(); return gate; }, track,
			async reached(entered, pending) { await Promise.race([entered, pending.then(() => { throw new Error('Expected held operation.'); }, (error: unknown) => { throw error; }), new Promise<never>((_accept, reject) => {
				if (context.signal.aborted) reject(context.signal.reason); else context.signal.addEventListener('abort', () => { reject(context.signal.reason); }, { once: true });
			})]); assert.equal(context.signal.aborted, false); },
		});
	} catch (error) { failed = true; primary = error; }
	cancel(); await Promise.allSettled([...work]);
	const cleanup: unknown[] = [];
	for (const owner of owners) { try { await owner.close(); } catch (error) { cleanup.push(error); } }
	for (const database of [db, source]) { try { database?.close(); } catch (error) { cleanup.push(error); } }
	try { await media?.close(); } catch (error) { cleanup.push(error); }
	read = null; Blob.prototype.arrayBuffer = BYTES; context.signal.removeEventListener('abort', cancel);
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native preview test retains unretired evidence.');
	await rm(appDataPath, { recursive: true, force: true }); if (failed) throw primary;
}
