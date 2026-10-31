/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizeImageDevelopStateV4 } from '../../src/common/editor/imaging/image-develop-state-v4.ts';
import { readPhotoCatalogPackV1 } from '../../src/lightscaper/archive/catalog-pack.ts';
import { readPhotoCatalogPackV2 } from '../../src/lightscaper/archive/catalog-pack-v2.ts';
import { readPhotoCatalogPackV3 } from '../../src/lightscaper/archive/catalog-pack-v3.ts';
import { readPhotoCatalogPackCurrentV1 } from '../../src/lightscaper/archive/catalog-pack-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
export const backupShaCurrentV1 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function scopedBackupFixtureCurrentV1(current = false) {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-scoped-backup-')));
	let scopes: Scopes | undefined;
	try {
		scopes = await Scopes.open({ appDataPath: directory });
		const scope = await scopes.openDefault(), components = await scopes.openComponents(scope);
		const seed = photoArchiveFixture().photo, bytes = Uint8Array.of(1, 2, 3);
		const photo = current ? normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: 3, versions: [{ ...seed.versions[0]!,
			develop: normalizeImageDevelopStateV4({ ...seed.versions[0]!.develop, processVersion: 4,
				rawDevelopment: { schemaVersion: 1, mode: 'canonical' }, repairs: { schemaVersion: 1, spots: [] } }) }] }) : seed;
		await components.catalog.createCatalog(normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1,
			kind: 'photo-catalog', id: photo.catalogId, name: 'Scoped retained backup', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }));
		await components.media.writeAsset(photo.original.storageKey, new Blob([bytes]), { name: photo.original.name, mimeType: photo.original.mimeType });
		await components.catalog.publishPhotos(photo.catalogId, 0, [photo]);
		await components.media.catalogOriginals.retain(photo.catalogId, [{ photoId: photo.id, sourceId: photo.original.id,
			assetId: photo.original.storageKey, sha256: photo.original.contentSha256, size: photo.original.byteLength }]);
		const catalog = components.catalog, body = new File([bytes], photo.original.name, { type: photo.original.mimeType });
		let acquired = 0, closed = 0, fallbacks = 0, closeFailure: unknown, closeFailed = false;
		const source: PhotoLibraryOriginalSourceCurrentV1 = { async acquire(request) {
			assert.equal(this, source); assert.equal(request.catalogId, photo.catalogId); assert.equal(request.photoId, photo.id);
			assert.equal(JSON.stringify(request.original), JSON.stringify(photo.original)); acquired++;
			return { body, async close() { closed++; if (closeFailed) throw closeFailure; } };
		} };
		const legacyCatalog = { readSnapshot: catalog.readSnapshot.bind(catalog), readSummaryPage: catalog.readSummaryPage.bind(catalog),
			async loadPhoto(catalogId: string, photoId: string) { const value = await catalog.loadPhoto(catalogId, photoId); return value === null ? null : normalizePhotoDocumentV1(value); } };
		const ports = { catalog, originalSource: source, async loadOriginal() { assert.equal(this, ports); fallbacks++; return body; } };
		const legacyPorts = { catalog: legacyCatalog, originalSource: source, async loadOriginal() { assert.equal(this, legacyPorts); fallbacks++; return body; } };
		let closing: Promise<void> | undefined;
		return { photo, body, bytes, catalog, legacyCatalog, source, ports, legacyPorts,
			calls: () => ({ acquired, closed, fallbacks }), failClose(error: unknown) { closeFailed = true; closeFailure = error; },
			close(): Promise<void> { closing ??= (async () => { await scopes!.close(); await rm(directory, { recursive: true, force: false }); })(); return closing; } };
	} catch (primary) {
		try { await scopes?.close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Scoped backup fixture setup/retirement failed; files retained.', { cause: cleanup }); }
		await rm(directory, { recursive: true, force: false }); throw primary;
	}
}
export async function assertScopedBackupRoundTripCurrentV1(blob: Blob, expected: Awaited<ReturnType<typeof scopedBackupFixtureCurrentV1>>, version: number) {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	try {
		const entries = await reader.getEntries(), entry = entries.find(value => value.filename === 'assets/photo-pack-000001.bin');
		assert.ok(entry && !entry.directory); const bytes = await entry.getData(new Uint8ArrayWriter());
		async function* chunks() { yield bytes; }
		const read = version === 1 ? readPhotoCatalogPackV1 : version === 8 ? readPhotoCatalogPackCurrentV1 : version === 6 ? readPhotoCatalogPackV3 : readPhotoCatalogPackV2;
		let count = 0;
		await read(chunks(), async (photo, original) => {
			count++; assert.equal(photo.id, expected.photo.id); assert.equal(JSON.stringify(photo.original), JSON.stringify(expected.photo.original));
			const digest = createHash('sha256'); let size = 0;
			for await (const bytes of original) { size += bytes.byteLength; digest.update(bytes); }
			assert.equal(size, expected.bytes.byteLength); assert.equal(digest.digest('hex'), backupShaCurrentV1(expected.bytes));
		}); assert.equal(count, 1);
	} finally { await reader.close(); }
}
