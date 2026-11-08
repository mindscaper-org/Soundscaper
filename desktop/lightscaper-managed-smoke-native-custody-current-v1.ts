/* SPDX-License-Identifier: AGPL-3.0-only */

import {DatabaseSync} from 'node:sqlite';
import {deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths} from './lightscaper-native-original-index-current-v1.ts';
import {readLightscaperNativePhotoLinkedUnavailableCurrentV1 as unavailable} from './lightscaper-native-photo-linked-unavailable-current-v1.ts';
import { createHash } from 'node:crypto';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from './lightscaper-native-photo-library-scopes-current-v1.ts';
import type { PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import type { LightscaperNativePhotoSessionLeaseCurrentV1 as Lease } from './lightscaper-native-photo-session-lease-current-v1.ts';
import { lightscaperSmokeStableJsonCurrentV1 as stable, type LightscaperSmokeCustodyCurrentV1 as Custody, type LightscaperSmokeFileCurrentV1 as Fixture } from './lightscaper-managed-smoke-contract-current-v1.ts';

/** Paired CLI smoke only. The transparent pass-through retains the exact real
	* lease and its actual Main receiver. It grants no new renderer authority. */
export function installLightscaperManagedSmokeNativeObserverCurrentV1(options:Readonly<{scenario?:'managed'|'linked';allowUnavailable?:boolean;appDataPath?:string}>={}): Readonly<{ read(photoIds: readonly string[], fixtures: readonly Fixture[]): Promise<Custody>; close(): Promise<void> }> {
	const original = Scopes.prototype.openSessionLease;
	let current: Readonly<{ scopes: Scopes; lease: Readonly<Lease> }> | undefined, closed = false, closing: Promise<void> | undefined;
	const active = new Set<Promise<Custody>>();
	const wrapper: typeof original = function (this: Scopes, scope, local, options) {
		const work = Reflect.apply(original, this, [scope, local, options]) as ReturnType<typeof original>;
		void work.then(lease => { if (!closed) current = { scopes: this, lease }; }, () => undefined); return work;
	};
	Scopes.prototype.openSessionLease = wrapper;
	return Object.freeze({
		read(photoIds, fixtures) {
			if (closed || !current) return Promise.reject(new Error('No actual live native Session lease owns this smoke checkpoint.'));
			const selected = current, work = read(selected.scopes, selected.lease, photoIds, fixtures,options); active.add(work);
			void work.then(() => { active.delete(work); }, () => { active.delete(work); }); return work;
		},
		close() {
			if (closing) return closing; closed = true;
			if (Scopes.prototype.openSessionLease === wrapper) Scopes.prototype.openSessionLease = original;
			closing = Promise.allSettled([...active]).then(() => { current = undefined; }); return closing;
		},
	});
}
async function read(scopes: Scopes, lease: Readonly<Lease>, photoIds: readonly string[], fixtures: readonly Fixture[],options:Readonly<{scenario?:'managed'|'linked';allowUnavailable?:boolean;appDataPath?:string}>): Promise<Custody> {
	lease.signal.throwIfAborted();
	if (!Array.isArray(photoIds) || photoIds.length !== 2 || new Set(photoIds).size !== 2 || !Array.isArray(fixtures) || fixtures.length !== 2) throw new RangeError('Managed native smoke requires two actual Photos and bounded fixtures.');
	const ids = [...photoIds], ownedFixtures = fixtures.map(file => ({ ...file }));
	if (ownedFixtures.some(file => !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > 65_536 || !/^[a-f0-9]{64}$/u.test(file.sha256))) throw new RangeError('Managed native fixture exceeds its bound.');
	const selected = await scopes.openSelected({ name: 'Managed smoke observation', signal: lease.signal });
	if (selected.selectionToken !== lease.selectionToken || selected.catalogId !== lease.catalogId) throw new Error('Native smoke selected epoch changed.');
	const namespace = scopes.describe(selected.scope)?.namespaceToken ?? null, c = lease.components,linked=options.scenario==='linked',storage=linked?'native-photo-linked-original':'native-photo-original';
	const snapshot = await c.catalog.readSnapshot(lease.catalogId, { signal: lease.signal });
	if (!snapshot || snapshot.catalog.photoCount !== 2) throw new Error('Native smoke catalog root is incomplete.');
	if (await c.settings.readImportIntentCurrentV1(lease.catalogId) !== null) throw new Error('Native smoke import custody has not fully settled.');
	const roots = await c.media.catalogOriginals.readPage({ catalogId: lease.catalogId, importId: null });
	if (roots.afterKey !== null || roots.roots.length !== 2) throw new Error('Native smoke permanent custody inventory is incomplete.');
	const photos: Array<Readonly<{ document: Readonly<PhotoDocumentCurrentV1>; sha256: string; byteLength: number; storage: string;bodyVerified?:boolean }>> = [];
	for (const id of ids) {
		lease.signal.throwIfAborted(); const document = await c.catalog.loadPhoto(lease.catalogId, id);
		if (!document) throw new Error('Native smoke selected Photo is missing.');
		const original = document.original, fixture = ownedFixtures.find(file => file.name === document.metadata.fileName);
		const root = roots.roots.find(root => root.photoId === id), metadata = await c.media.readSessionAssetMetadataCurrentV1(original.storageKey);
		if (!fixture || original.contentSha256 !== fixture.sha256 || original.byteLength !== fixture.byteLength || original.retention !== (linked?'linked':'managed')
			|| !metadata || metadata.sourceId !== original.storageKey || metadata.sha256 !== fixture.sha256 || metadata.size !== fixture.byteLength || metadata.storage !== storage
			|| !root || root.catalogId !== lease.catalogId || root.importId !== null || root.sourceId !== original.id || root.assetId !== original.storageKey || root.sha256 !== fixture.sha256 || root.size !== fixture.byteLength) throw new Error('Native smoke Photo, metadata, permanent root and fixture disagree.');
		let bodyVerified=true,sha256:string;try{sha256 = await c.originals.withOriginal({ catalogId: lease.catalogId, photoId: id, original }, async view => {
			const bytes = await view.read(0, fixture.byteLength);
			try { if (!(bytes instanceof Uint8Array) || bytes.byteLength !== fixture.byteLength) throw new Error('Native smoke Original read was short.'); return hash(bytes); }
			finally { bytes.fill(0); }
		}, { signal: lease.signal });}catch(error){if(!linked||!options.allowUnavailable||unavailable(error)===null)throw error;bodyVerified=false;sha256=root.sha256;}
		if (sha256 !== fixture.sha256 || JSON.stringify(await c.catalog.loadPhoto(lease.catalogId, id)) !== JSON.stringify(document)) throw new Error('Native smoke body digest or complete Photo changed during observation.');
		photos.push({ document, sha256, byteLength: fixture.byteLength, storage,...linked?{bodyVerified}:{} });
	}
	const after = await c.catalog.readSnapshot(lease.catalogId, { signal: lease.signal });
	if (JSON.stringify(after) !== JSON.stringify(snapshot) || JSON.stringify(await c.media.catalogOriginals.readPage({ catalogId: lease.catalogId, importId: null })) !== JSON.stringify(roots)) throw new Error('Native smoke catalog or custody changed during observation.');
	const final = await scopes.openSelected({ name: 'Managed smoke observation', signal: lease.signal }); lease.signal.throwIfAborted();
	if (final.selectionToken !== lease.selectionToken || final.catalogId !== lease.catalogId) throw new Error('Native smoke selection changed during observation.');
	photos.sort((a, b) => a.document.metadata.fileName.localeCompare(b.document.metadata.fileName, 'en'));
	const root = snapshot.catalog, fingerprint = hash(new TextEncoder().encode(stable({ root, photos: photos.map(({ document, sha256, byteLength }) => ({ document, sha256, byteLength })) })));
	let linkedInventory:Custody['linked'];if(linked&&options.appDataPath){if(namespace!==null)throw new Error('Linked smoke unexpectedly selected a restored generation.');const db=new DatabaseSync(paths(options.appDataPath).databasePath,{readOnly:true,allowExtension:false,enableDoubleQuotedStringLiterals:false});try{const rows=db.prepare("SELECT CASE WHEN typeof(i.kind)='text' AND length(CAST(i.kind AS BLOB))<=16 THEN i.kind END AS kind,l.revision,EXISTS(SELECT 1 FROM native_photo_original_bindings b WHERE b.storage_key=i.source_id) AS managed FROM native_photo_media_identities i JOIN native_photo_linked_original_bindings l ON l.storage_key=i.linked_key WHERE i.source_id IN (?,?) ORDER BY i.source_id").all(...photos.map(photo=>photo.document.original.storageKey));if(rows.length!==2||rows.some(row=>row.kind!=='linked'||row.managed!==0||typeof row.revision!=='number'||!Number.isSafeInteger(row.revision)||row.revision<0))throw new Error('Actual linked typed identities/locator revisions differ.');linkedInventory=Object.freeze({identities:2,managedBindings:0,locatorRevisions:Object.freeze(rows.map(row=>row.revision as number))});}finally{db.close();}}
	return { root, namespace, photos, fingerprint,...linkedInventory?{linked:linkedInventory}:{} };
}
function hash(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
