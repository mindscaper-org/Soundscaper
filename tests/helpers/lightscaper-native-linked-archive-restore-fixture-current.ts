/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { DesktopPhotoOriginalSourceCurrentV1 } from '../../src/lightscaper/desktop-photo-original-source-current-v1.ts';
import type { DesktopPhotoOriginalTransportCurrentV1 } from '../../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { exportPhotoLibraryBackupCurrentV1, type PhotoLibraryBackupPortsCurrentV1 } from '../../src/lightscaper/controller/photo-library-backup-current-v1.ts';
import { importPhotoCatalogArchiveV8 } from '../../src/lightscaper/archive/catalog-archive-import-v8.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoStackV1 } from '../../src/lightscaper/catalog/photo-stack-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../../src/lightscaper/catalog/photo-query-types-v2.ts';
import { normalizePhotoDevelopPresetRowV4 } from '../../src/lightscaper/storage/photo-develop-preset-row-v4.ts';
import { photoDevelopPresetsKeyV1 } from '../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { linkedOriginalsFixtureCurrentV1, CATALOG } from './lightscaper-native-linked-originals-integration-fixture-current.ts';
import { originalGroupFixtureCurrentV1 } from './lightscaper-desktop-original-group-fixture-current.ts';

export const linkedArchiveJsonShaCurrentV1 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type BackupPorts = Omit<PhotoLibraryBackupPortsCurrentV1, 'originalSource' | 'loadOriginal'>;

/** Genuine native Tickets supply every byte. Only the OPFS implementation is
 * the explicit bounded test port, which returns actual native File snapshots. */
export async function exportNativeLinkedPortableArchiveCurrentV1(context: TestContext, catalogId: string,
	ports: BackupPorts, transport: DesktopPhotoOriginalTransportCurrentV1, signal: AbortSignal): Promise<Blob> {
	const opfs = originalGroupFixtureCurrentV1(context), source = new DesktopPhotoOriginalSourceCurrentV1(transport, { storage: opfs.storage });
	const stop = (): void => { void source.close().catch(() => undefined); };
	signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
	let failed = false, primary: unknown, result: Blob | undefined;
	try {
		const exported = await exportPhotoLibraryBackupCurrentV1(catalogId, { ...ports, originalSource: source }, { signal, maximumBlobBytes: 8 * 1024 * 1024 });
		assert.ok(exported.blob); assert.equal(exported.document.schemaVersion, 8); assert.ok(exported.blob.size <= 8 * 1024 * 1024); result = exported.blob;
	} catch (error) { failed = true; primary = error; }
	const errors: unknown[] = [];
	try { await source.close(); } catch (error) { errors.push(error); }
	try { await opfs.close(); } catch (error) { errors.push(error); }
	signal.removeEventListener('abort', stop);
	if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Portable archive local owners did not retire.', { cause: errors[0] });
	if (failed) throw primary; assert.ok(result); return result;
}

/** Two actual granted files, distinct native locators and one shared SHA; full
 * Current resources, exact edits, stack, saved collection and physical presets. */
export async function nativeLinkedPortableArchiveCurrentV1(context: TestContext) {
	let result: Awaited<ReturnType<typeof seedArchive>> | undefined;
	await linkedOriginalsFixtureCurrentV1(context, async f => { result = await seedArchive(context, f); });
	assert.ok(result); return result;
}
async function seedArchive(context: TestContext, f: Parameters<Parameters<typeof linkedOriginalsFixtureCurrentV1>[1]>[0]) {
	const first = await f.rich(await f.prepare('Portable linked one.dng'));
	const second = await f.prepare('Portable linked two.dng', first.bytes);
	await f.publish(first); await f.publish(second);
	const signal = f.scope.signal;
	await f.catalog.savePhoto(normalizePhotoDocumentCurrentV1({ ...first.photo,
		metadata: { ...first.photo.metadata, caption: 'Exact source edit before portable backup' } }), first.photo.revision, { signal });
	const before = await f.catalog.loadCatalog(CATALOG); assert.ok(before);
	const stack = await f.catalog.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: CATALOG,
		id: 'portable-linked-stack', revision: 0, photoIds: [first.photo.id, second.photo.id], coverPhotoId: second.photo.id }), null,
	{ expectedCatalogRevision: before.revision, expectedStateRevision: 0, signal });
	const snapshot = await f.catalog.readSmartCollectionSnapshotV1(CATALOG, null, { signal });
	await f.catalog.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: CATALOG,
		id: 'portable-linked-saved', revision: 0, name: 'Portable linked aliases', query: normalizePhotoCatalogQueryV2({ schemaVersion: 2,
			kind: 'photo-catalog-query', sort: { field: 'photo-id', direction: 'descending' } }) }, null,
	{ expectedCatalogRevision: snapshot.context.catalogRevision, expectedIndexRevision: snapshot.context.indexRevision,
		expectedStateRevision: snapshot.context.collectionStateRevision, signal });
	const saved = await f.catalog.loadSmartCollection(CATALOG, 'portable-linked-saved', { signal }); assert.ok(saved);
	const preset = normalizePhotoDevelopPresetRowV4({ schemaVersion: 4, kind: 'photo-develop-presets', catalogId: CATALOG, revision: 7, presets: [] }, CATALOG);
	await f.settings.settingsRepository.put(photoDevelopPresetsKeyV1(CATALOG), preset);
	const root = await f.catalog.loadCatalog(CATALOG); assert.ok(root);
	const photos: ReturnType<typeof normalizePhotoDocumentCurrentV1>[] = [];
	for (const entry of [first, second]) { const photo = await f.catalog.loadPhoto(CATALOG, entry.photo.id); assert.ok(photo); photos.push(photo); }
	const savedState = await f.catalog.readSmartCollectionState(CATALOG, { signal });
	const lut = await f.resources.cubeLutResources(), masks = await f.resources.maskRasterResources();
	const blob = await exportNativeLinkedPortableArchiveCurrentV1(context, CATALOG, { catalog: f.catalog, stacks: f.catalog,
		developPresetSettings: f.settings.settingsRepository, lutResources: lut.source, maskRasters: masks.source }, f.tickets.transport, signal);
	return { blob, root, photos, stack, saved, savedState, preset };
}

/** Observational use of the actual V8 codec and its identity/resource checks.
 * This callback owns no native DB and mints no native Ready/body authority. */
export async function readNativeLinkedPortableArchiveCurrentV1(blob: Blob, signal: AbortSignal) {
	const photos: ReturnType<typeof normalizePhotoDocumentCurrentV1>[] = [], bodies: Array<Readonly<{ sha256: string; byteLength: number }>> = [];
	const stacks: unknown[] = [], saved: unknown[] = []; let preset: unknown, luts = 0, masks = 0, published = false;
	const root = await importPhotoCatalogArchiveV8(blob, async () => ({
		async writePhoto(value, original) {
			signal.throwIfAborted(); const photo = normalizePhotoDocumentCurrentV1(value), hash = createHash('sha256'); let byteLength = 0;
			for await (const bytes of original) { signal.throwIfAborted(); byteLength += bytes.byteLength; assert.ok(byteLength <= photo.original.byteLength); hash.update(bytes); }
			const sha256 = hash.digest('hex'); assert.equal(byteLength, photo.original.byteLength); assert.equal(sha256, photo.original.contentSha256);
			photos.push(photo); bodies.push(Object.freeze({ sha256, byteLength }));
		},
		async writeStack(value) { stacks.push(value); }, async writeSavedCollection(value) { saved.push(value); },
		async writeDevelopPresets(value) { preset = value; }, async writeLut() { luts++; }, async writeMaskRaster() { masks++; },
		async publish() { published = true; }, async rollback() { /* Observational parser has no installed generation. */ },
	}), { signal });
	assert.equal(published, true); return { root, photos, bodies, stacks, saved, preset, luts, masks };
}

export async function nativeLinkedArchiveBlobShaCurrentV1(blob: Blob, signal: AbortSignal): Promise<string> {
	const hash = createHash('sha256');
	for (let offset = 0; offset < blob.size; offset += 1024 * 1024) { signal.throwIfAborted();
		const bytes = new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer()); hash.update(bytes); bytes.fill(0); }
	return hash.digest('hex');
}
