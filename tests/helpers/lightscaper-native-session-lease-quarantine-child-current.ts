/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import type { LightscaperNativePhotoSessionLeaseCurrentV1 as Lease } from '../../desktop/lightscaper-native-photo-session-lease-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { scopePhotoCurrentV1, scopeOriginalReferenceCurrentV1 as reference } from './lightscaper-native-library-scope-integration-fixture-current.ts';

export interface NativeSessionLeaseQuarantineTerminalCurrentV1 { readonly phase: 'terminal'; readonly managerCloseFailed: boolean }
export interface NativeSessionLeaseQuarantineReadyCurrentV1 {
	readonly phase: 'quarantined'; readonly initialized: boolean; readonly bodyMatched: boolean; readonly consumerJoined: boolean;
	readonly closeFailed: boolean; readonly cached: boolean; readonly localCalls: number; readonly refused: readonly boolean[]; readonly traps: number;
}
const directory = process.argv[2]; if (!directory || !process.send) throw new Error('Native selected lease child needs actual fork IPC/appData.');
const send = process.send.bind(process), released = new Promise<void>(resolve => { process.once('message', () => { resolve(); }); });
const post = (value: NativeSessionLeaseQuarantineReadyCurrentV1 | NativeSessionLeaseQuarantineTerminalCurrentV1): Promise<void> =>
	new Promise((resolve, reject) => { send(value, error => { if (error) reject(error); else resolve(); }); });
let manager: Scopes | undefined, initialized = false, bodyMatched = false, consumerJoined = false, closeFailed = false, cached = false, localCalls = 0, traps = 0;
let held: Promise<unknown> | undefined, release!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; }), refused: boolean[] = [];
async function rejects(run: () => unknown): Promise<boolean> { try { await run(); return false; } catch { return true; } }
try {
	manager = await Scopes.open({ appDataPath: directory }); const selected = await manager.openSelected({ name: 'Quarantined real selected lease' });
	const seed = await manager.openComponents(selected.scope), entry = scopePhotoCurrentV1();
	const photo = normalizePhotoDocumentCurrentV1({ ...entry.photo, catalogId: selected.catalogId });
	try {
		await seed.media.writeAsset(photo.original.storageKey, entry.blob, { name: photo.original.name, mimeType: photo.original.mimeType });
		await seed.media.catalogOriginals.retain(photo.catalogId, [reference(photo.original, photo.id)]);
		const root = await seed.catalog.loadCatalog(photo.catalogId); if (!root) throw new Error('Actual selected Catalog missing.');
		await seed.catalog.publishPhotos(root.id, root.revision, [photo]);
	} finally { await seed.close(); }
	const local = { async close() {
		if (this !== local) throw new Error('Captured local receiver changed.'); localCalls++; release();
		await Promise.allSettled(held ? [held] : []); consumerJoined = true;
		// Actual local work has retired, but its cleanup receipt fails. The
		// parent must conservatively retain physical storage and exclusion.
		throw new Error('Injected local cleanup receipt failure after actual native Original callback retirement.');
	} };
	const method: unknown = Reflect.get(manager, 'openSessionLease'); if (typeof method !== 'function') throw new Error('Real selected lease entrypoint absent.');
	const lease = await Reflect.apply(method, manager, [selected.scope, local]) as Readonly<Lease>;
	let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
	held = lease.components.originals.withOriginal({ catalogId: photo.catalogId, photoId: photo.id, original: photo.original }, async view => {
		const bytes = await view.read(0, Math.min(1024 * 1024, entry.bytes.byteLength));
		try { bodyMatched = createHash('sha256').update(bytes).digest('hex') === createHash('sha256').update(entry.bytes).digest('hex'); entered(); await gate; }
		finally { bytes.fill(0); }
	}); void held.catch(() => undefined);
	await Promise.race([ready, held.then(() => { throw new Error('Actual native consumer ended before its hold.'); })]); initialized = true;
	const closing = lease.close(); cached = lease.close() === closing;
	try { await closing; } catch { closeFailed = true; }
	const owner = manager, poison = new Proxy({}, { get() { traps++; throw new Error('Quarantine get'); }, ownKeys() { traps++; throw new Error('Quarantine shape'); }, getPrototypeOf() { traps++; throw new Error('Quarantine prototype'); } });
	for (const [methodValue, args] of [[owner.openDefault, [poison]], [owner.openSelected, [poison]], [owner.allocate, [poison, poison]], [owner.openComponents, [poison, poison]],
		[owner.readAllocationPage, [poison, poison]], [lease.components.catalog.loadCatalog, [poison]], [lease.components.media.writeAsset, [poison, poison, poison, poison]]] as const) {
		refused.push(await rejects(() => Reflect.apply(methodValue, owner, args)));
	}
} catch { /* Bounded report distinguishes fixture failure from expected quarantine. */ }
release(); await Promise.allSettled(held ? [held] : []);
await post({ phase: 'quarantined', initialized, bodyMatched, consumerJoined, closeFailed, cached, localCalls, refused, traps });
await released; let managerCloseFailed = false;
if (manager) { try { await manager.close(); } catch { managerCloseFailed = true; } }
await post({ phase: 'terminal', managerCloseFailed }); process.disconnect?.();
