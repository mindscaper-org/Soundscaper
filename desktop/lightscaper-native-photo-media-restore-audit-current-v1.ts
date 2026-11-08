/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readLightscaperNativeOriginalBodyHeadCurrentV1 as readOriginalHead } from './lightscaper-native-original-body-head-current-v1.ts';
import { auditLightscaperNativeOriginalRestoreInventoryCurrentV1 as inventoryOriginalLocators } from './lightscaper-native-original-restore-inventory-current-v1.ts';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { catalogOriginalKey, catalogOriginalScope, normalizeCatalogOriginalRoot } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import type { PhotoCatalogRestoreDeliveryForProfileV1 } from '../src/lightscaper/catalog/internal/photo-catalog-restore-records-kernel-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import type { PhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import type { PhotoCatalogRootV1, PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import type { PhotoLibraryRestoreAllocationV1 as Allocation } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { encodeLightscaperNativePhotoSettingKeyCurrentV1 as key } from './lightscaper-native-photo-settings-request-current-v1.ts';
import type { LightscaperNativePhotoMediaCurrentV1 as Media } from './lightscaper-native-photo-media-current-v1.ts';
import type { LightscaperNativePhotoResourcesCurrentV1 as Resources } from './lightscaper-native-photo-resources-current-v1.ts';
import type { LightscaperNativePhotoSettingsCurrentV1 as Settings } from './lightscaper-native-photo-settings-current-v1.ts';
import { hashLightscaperNativePhotoMediaRestoreBodyCurrentV1 as hashBody } from './lightscaper-native-photo-media-restore-body-current-v1.ts';
import { readLightscaperNativePhotoMediaRestorePresetPayloadCurrentV1 as readPreset, readLightscaperNativePhotoMediaRestoreMetadataCurrentV1 as readMetadata } from './lightscaper-native-photo-media-restore-payload-current-v1.ts';
import type { LightscaperNativeCatalogRestoreAuditCurrentV1 as CatalogAudit } from './lightscaper-native-catalog-restore-stage-current-v1.ts';
import { captureLightscaperNativePhotoMediaRestorePresetCurrentV1 as preset, lightscaperNativePhotoMediaRestoreDigestCurrentV1 as digest,
	type LightscaperNativePhotoMediaRestoreDeclarationsCurrentV1 as Declarations } from './lightscaper-native-photo-media-restore-contract-current-v1.ts';

export interface LightscaperNativePhotoMediaRestoreAuditInputCurrentV1 {
	readonly database: DatabaseSync; readonly resourcesDatabase: DatabaseSync; readonly settingsDatabase: DatabaseSync;
	readonly root: PhotoCatalogRootV1; readonly allocation: Allocation; readonly declarations: Declarations;
	readonly catalog: CatalogAudit; readonly media: Media; readonly resources: Resources; readonly settings: Settings;
	readonly presetDigest: string | null; readonly presetPayloadBytes: number | null; readonly originalCount: number; readonly originalByteLength: number;
	readonly locatorMetadata: ReadonlyMap<string, string>; readonly signal: AbortSignal; readonly assertCurrent: () => void; readonly delivery: PhotoCatalogRestoreDeliveryForProfileV1<'current4'>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
type Input = LightscaperNativePhotoMediaRestoreAuditInputCurrentV1;
/** The catalog is an actual sealed same-allocation owner. Scalar pages and one
 * full Current Photo are retained; no SQL transaction spans a physical await. */
export async function auditLightscaperNativePhotoMediaRestoreCurrentV1(input: Input): Promise<Readonly<{ inventorySha256: string; versions: readonly number[] }>> {
	const { database, resourcesDatabase, settingsDatabase, allocation, root, signal } = input;
	let versions = stamps(input), count = 0, after: string | null = null;
	const current = (): void => { input.assertCurrent(); check(signal); if (JSON.stringify(stamps(input)) !== JSON.stringify(versions)) throw new Error('Native restore media inventory changed during audit.'); };
	const closure = createPhotoResourceReachabilityCurrentV1(), hash = createHash('sha256');
	current();
	const entry = readPreset(settingsDatabase, root.id, input.presetPayloadBytes); current();
	let row: PhotoDevelopPresetRowCurrentV1 | null = null;
	if (input.declarations.presets === null) { if (entry.present || input.presetDigest !== null) throw new Error('Absent native restored presets became physical.'); }
	else {
		if (!entry.present || input.presetDigest === null) throw new Error('Native restored preset row is missing.');
		row = preset(entry.value, root.id, input.declarations.presets);
		if (digest(row) !== input.presetDigest) throw new Error('Native restored preset delivery changed.'); closure.addPresetRow(row, root.id);
	}
	for (;;) {
		current(); const page = await input.catalog.readPhotoKeyPage(after); current();
		for (const selected of page.keys) {
			if (++count > root.photoCount) throw new Error('Native restore has excess catalog Photos.');
			const photo = await input.catalog.readPhoto(selected.photoId); current();
			if (photo.id !== selected.photoId || photo.catalogId !== root.id || selected.key !== `${root.id}|${photo.id}`) throw new Error('Native restore Photo key changed.');
			input.delivery.assertDelivered(photo); closure.addPhoto(photo); const original = photo.original;
			const metadata = readMetadata(database, original); current();
			metadataMatches(input, original, metadata);
			await hashBody(input.media, { catalogId: root.id, photoId: photo.id, original, importId: allocation.operationId }, signal); current();
			await verifyPhotoResourcesCurrentV1(photo, input.resources, signal); current();
			const native = rootFor(database, root.id, allocation.operationId, photo.id, original); frame(hash, ['photo', selected.key, native]);
		}
		if (page.afterKey === null) break;
		if (page.afterKey === after || !page.keys.length) throw new Error('Native restore catalog cursor did not advance.'); after = page.afterKey;
		await nextTurn(); current();
	}
	if (count !== root.photoCount) throw new Error('Native restore catalog and media delivery counts differ.');
	const reached = closure.finish();
	if (JSON.stringify(reached.luts) !== JSON.stringify(input.declarations.luts) || JSON.stringify(reached.brushes) !== JSON.stringify(input.declarations.brushes)) throw new Error('Native restore reachable resource declarations differ.');
	const luts = await input.resources.cubeLutResources(), brushes = await input.resources.maskRasterResources(); current();
	await luts.verifyReferencesV1!(reached.luts, signal); current(); await brushes.verifyReferencesV1!(reached.brushes, signal); current();
	await inventoryResources(resourcesDatabase, input.declarations, hash, current); inventorySettings(settingsDatabase, row, root.id, hash);
	await inventoryAssets(database, input, hash, false, current); current();
	// Every provisional root is authenticated before bounded real promotion.
	after = null; let promoted = 0;
	for (;;) {
		const page = await input.media.catalogOriginals.readPage({ catalogId: root.id, importId: allocation.operationId, afterKey: after }, { signal }); current();
		for (let offset = 0; offset < page.roots.length; offset += 16) {
			const ids = page.roots.slice(offset, offset + 16).map(value => value.photoId);
			await input.media.catalogOriginals.promote(root.id, allocation.operationId, ids, { signal });
			const changed = stamps(input);
			if (changed[1] !== versions[1] || changed[2] !== versions[2]) throw new Error('Native restore resources/settings changed during custody promotion.');
			versions = Object.freeze([changed[0]!, versions[1]!, versions[2]!]); current(); promoted += ids.length;
		}
		if (page.afterKey === null) break; if (page.afterKey === after) throw new Error('Native restore custody cursor did not advance.'); after = page.afterKey;
		await nextTurn(); current();
	}
	if (promoted !== root.photoCount) throw new Error('Native restore custody promotion is incomplete.');
	const final = createHash('sha256'); frame(final, ['catalog', root]); frame(final, ['delivery', hash.digest('hex')]);
	// Promotion is not authority to change a Photo's full Original. Rewalk the
	// genuine sealed catalog and authenticate every final permanent root.
	after = null; let permanent = 0;
	for (;;) {
		const page = await input.catalog.readPhotoKeyPage(after); current();
		for (const selected of page.keys) {
			const photo = await input.catalog.readPhoto(selected.photoId); current(); input.delivery.assertDelivered(photo);
			const metadata = readMetadata(database, photo.original); current();
			metadataMatches(input, photo.original, metadata);
			await hashBody(input.media, { catalogId: root.id, photoId: photo.id, original: photo.original, importId: null }, signal); current();
			frame(final, ['permanent', rootFor(database, root.id, null, photo.id, photo.original)]); permanent++;
		}
		if (page.afterKey === null) break; if (page.afterKey === after) throw new Error('Native restore permanent cursor did not advance.'); after = page.afterKey;
		await nextTurn(); current();
	}
	if (permanent !== root.photoCount) throw new Error('Native restore permanent custody is incomplete.');
	await inventoryAssets(database, input, final, true, current); await inventoryResources(resourcesDatabase, input.declarations, final, current); inventorySettings(settingsDatabase, row, root.id, final);
	// Re-enter the genuine sealed view after all physical/resource work. Its
	// own data_version fence rejects independent post-finish catalog changes.
	await input.catalog.readPhotoKeyPage(null); current(); return Object.freeze({ inventorySha256: final.digest('hex'), versions });
}
function rootFor(db: DatabaseSync, catalogId: string, importId: string | null, photoId: string, original: Readonly<PhotoOriginalV1>) {
	const value = db.prepare('SELECT CASE WHEN length(root_key)<=4096 THEN root_key END AS root_key,CASE WHEN length(scope_key)<=4096 THEN scope_key END AS scope_key,CASE WHEN length(asset_id)<=128 THEN asset_id END AS asset_id,CASE WHEN length(CAST(root AS BLOB))<=2048 THEN root END AS root FROM native_photo_media_roots WHERE root_key=?').get(key(catalogOriginalKey(catalogId, importId, photoId)));
	if (!value || typeof value.root !== 'string') throw new Error('Native restore staged Photo custody is missing.');
	const root = normalizeCatalogOriginalRoot(JSON.parse(value.root) as unknown), asset = db.prepare('SELECT CASE WHEN length(media_content_token)<=142 THEN media_content_token END AS media_content_token FROM native_photo_media_assets WHERE source_id=?').get(original.storageKey);
	if (JSON.stringify(root) !== value.root || !equal(value.root_key, key(root.key)) || !equal(value.scope_key, key(root.scope)) || value.asset_id !== original.storageKey
		|| root.catalogId !== catalogId || root.importId !== importId || root.photoId !== photoId || root.sourceId !== original.id || root.assetId !== original.storageKey
		|| root.sha256 !== original.contentSha256 || root.size !== original.byteLength || root.mediaContentToken !== asset?.media_content_token) throw new Error('Native restore Original binding/custody differs.');
	return root;
}
async function inventoryAssets(db: DatabaseSync, input: Input, hash: ReturnType<typeof createHash>, permanent: boolean, current: () => void): Promise<void> {
	const expected = input.root.photoCount, scope = catalogOriginalScope(input.root.id, permanent ? null : input.allocation.operationId);
	if (count(db, 'native_photo_media_roots') !== expected || count(db, 'native_photo_media_assets') !== input.originalCount
		|| count(db, 'native_photo_original_bindings') !== input.originalCount) throw new Error('Native restore body/custody inventory count differs.');
	let after: string | null = null, total = 0, bytes = 0;
	for (;;) {
		const rows: Record<string, SQLOutputValue>[] = after === null ? db.prepare('SELECT CASE WHEN length(source_id)<=128 THEN source_id END AS source_id,CASE WHEN length(sha256)=64 THEN sha256 END AS sha256,size,CASE WHEN length(media_content_token)<=142 THEN media_content_token END AS media_content_token,CASE WHEN length(metadata)<=65536 THEN metadata END AS metadata,root_count,CASE WHEN length(committed_at)<=24 THEN committed_at END AS committed_at,CASE WHEN length(pending_until)<=24 THEN pending_until END AS pending_until FROM native_photo_media_assets ORDER BY source_id LIMIT 64').all()
			: db.prepare('SELECT CASE WHEN length(source_id)<=128 THEN source_id END AS source_id,CASE WHEN length(sha256)=64 THEN sha256 END AS sha256,size,CASE WHEN length(media_content_token)<=142 THEN media_content_token END AS media_content_token,CASE WHEN length(metadata)<=65536 THEN metadata END AS metadata,root_count,CASE WHEN length(committed_at)<=24 THEN committed_at END AS committed_at,CASE WHEN length(pending_until)<=24 THEN pending_until END AS pending_until FROM native_photo_media_assets WHERE source_id>? ORDER BY source_id LIMIT 64').all(after);
		for (const row of rows) {
			if (typeof row.source_id !== 'string' || typeof row.size !== 'number' || !Number.isSafeInteger(row.size) || row.size < 1
				|| !(row.metadata instanceof Uint8Array) || typeof row.committed_at !== 'string' || typeof row.pending_until !== 'string') throw new TypeError('Native restore asset scalar is malformed.');
			const binding = db.prepare('SELECT CASE WHEN length(content_sha256)=64 THEN content_sha256 END AS content_sha256,byte_length FROM native_photo_original_bindings WHERE storage_key=?').get(row.source_id);
			const roots = db.prepare('SELECT COUNT(*) AS n FROM native_photo_media_roots WHERE asset_id=?').get(row.source_id)?.n;
			if (!binding || binding.content_sha256 !== row.sha256 || binding.byte_length !== row.size || roots !== row.root_count || row.root_count === 0) throw new Error('Native restore asset binding/count differs.');
			frame(hash, ['original-body-head', readOriginalHead(db, { storageKey: row.source_id, contentSha256: binding.content_sha256, byteLength: binding.byte_length })]);
			frame(hash, ['asset', { ...row, metadata: createHash('sha256').update(row.metadata).digest('hex') }]); total++; bytes += row.size;
			if (!Number.isSafeInteger(bytes)) throw new RangeError('Native restore body total exceeds its scalar budget.'); after = row.source_id;
		}
		if (rows.length < 64) break; await nextTurn(); current();
	}
	if (total !== input.originalCount || bytes !== input.originalByteLength) throw new Error('Native restore Original totals differ.');
	await inventoryOriginalLocators(db, row => { frame(hash, ['original-body-locator', row]); }, current);
	const rows = db.prepare('SELECT 1 AS present FROM native_photo_media_roots WHERE scope_key<>? LIMIT 1').get(key(scope));
	if (rows) throw new Error('Native restore contains foreign or mixed custody phases.');
	let afterRoot: Uint8Array | null = null;
	for (;;) {
		const roots: Record<string, SQLOutputValue>[] = afterRoot === null ? db.prepare('SELECT CASE WHEN length(root_key)<=4096 THEN root_key END AS root_key,CASE WHEN length(scope_key)<=4096 THEN scope_key END AS scope_key,CASE WHEN length(asset_id)<=128 THEN asset_id END AS asset_id,CASE WHEN length(CAST(root AS BLOB))<=2048 THEN root END AS root FROM native_photo_media_roots ORDER BY root_key LIMIT 64').all()
			: db.prepare('SELECT CASE WHEN length(root_key)<=4096 THEN root_key END AS root_key,CASE WHEN length(scope_key)<=4096 THEN scope_key END AS scope_key,CASE WHEN length(asset_id)<=128 THEN asset_id END AS asset_id,CASE WHEN length(CAST(root AS BLOB))<=2048 THEN root END AS root FROM native_photo_media_roots WHERE root_key>? ORDER BY root_key LIMIT 64').all(afterRoot);
		for (const row of roots) {
			if (typeof row.root !== 'string' || !(row.root_key instanceof Uint8Array)) throw new TypeError('Native restore custody row is malformed.');
			const root = normalizeCatalogOriginalRoot(JSON.parse(row.root) as unknown);
			if (JSON.stringify(root) !== row.root || !equal(row.root_key, key(root.key)) || !equal(row.scope_key, key(root.scope)) || row.asset_id !== root.assetId || root.scope !== scope) throw new Error('Native restore custody projection differs.');
			frame(hash, ['root', root]); afterRoot = row.root_key;
		}
		if (roots.length < 64) break; await nextTurn(); current();
	}
}
async function inventoryResources(db: DatabaseSync, declarations: Declarations, hash: ReturnType<typeof createHash>, current: () => void): Promise<void> {
	const expected = [...declarations.luts.map(reference => ({ family: 'lut', reference })), ...declarations.brushes.map(reference => ({ family: 'brush', reference }))].sort((a, b) => a.reference.storageKey < b.reference.storageKey ? -1 : 1);
	if (count(db, 'native_photo_resources') !== expected.length) throw new Error('Native restore physical resource inventory differs.');
	let scanned = 0; for (const entry of expected) {
		const row = db.prepare('SELECT storage_key,family,CASE WHEN length(CAST(reference AS BLOB))<=4096 THEN reference END AS reference,length(body) AS bytes FROM native_photo_resources WHERE storage_key=?').get(entry.reference.storageKey);
		if (!row || row.storage_key !== entry.reference.storageKey || row.family !== entry.family || row.reference !== JSON.stringify(entry.reference) || row.bytes !== entry.reference.byteLength) throw new Error('Native restore physical resource projection differs.'); frame(hash, ['resource', row]);
		if (++scanned % 64 === 0) { await nextTurn(); current(); }
	}
}
function inventorySettings(db: DatabaseSync, row: PhotoDevelopPresetRowCurrentV1 | null, catalogId: string, hash: ReturnType<typeof createHash>): void {
	if (count(db, 'native_photo_settings') !== (row === null ? 0 : 1)) throw new Error('Native restore has unarchived settings.');
	if (row !== null) {
		const stored = db.prepare('SELECT CASE WHEN length(scope)<=137 THEN scope END AS scope,CASE WHEN length(key)<=1024 THEN key END AS key FROM native_photo_settings LIMIT 1').get();
		if (!stored || stored.scope !== 'selected:library' || !equal(stored.key, key(photoDevelopPresetsKeyV1(catalogId)))) throw new Error('Native restore preset physical key differs.');
	}
	frame(hash, ['presets', row]);
}
function count(db: DatabaseSync, table: 'native_photo_media_roots' | 'native_photo_media_assets' | 'native_photo_original_bindings' | 'native_photo_resources' | 'native_photo_settings'): number {
	const result = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n;
	if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) throw new TypeError('Native restore count is malformed.'); return result;
}
export function readLightscaperNativePhotoMediaRestoreVersionsCurrentV1(input: Pick<Input, 'database' | 'resourcesDatabase' | 'settingsDatabase'>): readonly number[] {
	return Object.freeze([input.database, input.resourcesDatabase, input.settingsDatabase].map(db => {
		const value = db.prepare('PRAGMA data_version').get()?.data_version;
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError('Native restore data version is malformed.'); return value;
	}));
}
const stamps = readLightscaperNativePhotoMediaRestoreVersionsCurrentV1;
function equal(a: unknown, b: Uint8Array): boolean { return a instanceof Uint8Array && a.byteLength === b.byteLength && a.every((value, index) => value === b[index]); }
function frame(hash: ReturnType<typeof createHash>, value: unknown): void { const bytes = Buffer.from(JSON.stringify(value), 'utf8'), size = Buffer.alloc(4); size.writeUInt32LE(bytes.length); hash.update(size); hash.update(bytes); }
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

function metadataMatches(input: Input, original: Readonly<PhotoOriginalV1>, metadata: Record<string, unknown> | null): void {
	if (!metadata || Object.keys(metadata).length !== 9 || metadata.sourceId !== original.storageKey || metadata.sha256 !== original.contentSha256 || metadata.size !== original.byteLength
		|| digest({ name: metadata.name, mimeType: metadata.mimeType, lastModified: metadata.lastModified }) !== input.locatorMetadata.get(original.storageKey)) throw new Error('Native restore asset metadata differs from its own delivery.');
}
