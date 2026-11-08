/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import { readPhotoCatalogPackCurrentV1 } from '../src/lightscaper/archive/catalog-pack-current-v1.ts';
import { nativeSessionClientFixtureCurrentV1 as fixture, runtimeShaCurrentV1 as sha, remainsPending } from './helpers/lightscaper-desktop-native-session-client-integration-fixture-current.ts';

void test('Complete protocol desktop Current Session authenticates whole alias group/resources then writes a real roundtrippable Current ZIP', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const session = await f.open(), capture = session.collectionHandoffCurrent; assert.ok(capture);
		const root = await f.components.catalog.loadCatalog(f.selected.catalogId); assert.ok(root); const filesBefore = f.storage.events.filter(event => event === 'get-file').length;
		await capture.withCapture({ catalogId: root.id, collectionId: 'manual', scope: 'catalog', expectedCatalogRevision: root.revision }, async view => {
			assert.equal(view.schemaVersion, 2); assert.equal(view.photos.length, 3);
			for (const item of view.photos) await view.withOriginal(item.binding.photoId, async body => {
				assert.ok(body instanceof Blob); const bytes = new Uint8Array(await body.arrayBuffer());
				try { assert.equal(sha(bytes), sha(item.binding.photoId === 'runtime-hdr' ? f.hdr : f.raw)); } finally { bytes.fill(0); }
			});
			assert.equal(view.lutReferences.length, 1); assert.equal(view.maskRasterReferences.length, 2);
			await view.withLutBytes(view.lutReferences[0]!, bytes => { assert.equal(sha(bytes), sha(f.resource.lut.bytes)); });
			for (const reference of view.maskRasterReferences) await view.withMaskRasterBytes(reference, bytes => { assert.ok(bytes.byteLength > 0); });
		});
		assert.equal(f.storage.events.filter(event => event === 'get-file').length - filesBefore, 2, 'Three independently authorized Photos share exactly two actual physical File stages.');
		assert.equal(f.storage.counts().stages, 0);
		const result = await session.backupCatalog(); assert.equal(result.photoCount, 3); assert.ok(result.blob instanceof Blob); assert.ok(result.byteLength < 256 * 1024);
		const zip = new ZipReader(new BlobReader(result.blob), { useWebWorkers: false });
		try {
			const entries = await zip.getEntries(); assert.ok(entries.length < 64); const pack = entries.find(entry => entry.filename === 'assets/photo-pack-000001.bin'); assert.ok(pack && !pack.directory);
			const data = await pack.getData(new Uint8ArrayWriter()); let count = 0;
			async function* chunks() { yield data; }
			await readPhotoCatalogPackCurrentV1(chunks(), async (photo, original) => {
				count++; const hash = createHash('sha256'); let length = 0;
				for await (const bytes of original) { hash.update(bytes); length += bytes.byteLength; }
				assert.equal(length, photo.original.byteLength); assert.equal(hash.digest('hex'), photo.original.contentSha256);
			}); assert.equal(count, 3);
		} finally { await zip.close(); }
		assert.equal(f.storage.counts().stages, 0);
	});
});

void test('Complete protocol desktop Current inspection/repair replaces corrupt body through actual fresh native locator and survives Session reopen', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const session = await f.open(); await session.readPage(); await f.corruptLegacy(f.photos[0]!);
		const page = await session.inspectOriginals(), row = page.rows.find(row => row.photoId === f.photos[0]!.id); assert.ok(row); assert.equal(row.inspection.status, 'corrupt');
		const ack = await session.restoreOriginalBody({ schemaVersion: 1, catalogRevision: page.revision, activeImportId: page.activeImportId,
			photoRevision: row.revision, binding: row.binding }, new File([f.raw], row.fileName, { type: row.binding.mimeType }));
		assert.equal(ack.photoId, row.photoId); assert.equal(ack.sha256, sha(f.raw)); assert.deepEqual(ack.notices, []);
		assert.equal((await session.inspectOriginals()).rows.every(row => row.inspection.status === 'present'), true);
		await session.close(); await f.reopen(); const reopened = await f.open();
		const repaired = (await reopened.inspectOriginals()).rows.find(value => value.photoId === row.photoId); assert.ok(repaired); assert.equal(repaired.inspection.status, 'present');
		const photo = await f.components.catalog.loadPhoto(f.selected.catalogId, row.photoId); assert.ok(photo); assert.deepEqual(photo.original, f.photos[0]!.original);
	});
});

for (const manager of [false, true]) void test(`Complete protocol desktop ${manager ? 'manager' : 'outer Session'} close joins escaped actual collection File/resource children before native storage retirement`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const session = await f.open(), capture = session.collectionHandoffCurrent; assert.ok(capture);
		const root = await f.components.catalog.loadCatalog(f.selected.catalogId); assert.ok(root);
		const entered = f.gate(), resourceEntered = f.gate(), release = f.gate(); let child: Promise<unknown> | undefined, resourceChild: Promise<unknown> | undefined, closing: Promise<void> | undefined;
		const work = f.track(capture.withCapture({ catalogId: root.id, collectionId: 'manual', scope: 'catalog', expectedCatalogRevision: root.revision }, view => {
			child = view.withOriginal(f.photos[0]!.id, async body => {
				const bytes = new Uint8Array(await body.arrayBuffer()); try { assert.equal(sha(bytes), sha(f.raw)); entered.release(); await release.promise; } finally { bytes.fill(0); }
			}); void child.catch(() => undefined);
			resourceChild = view.withLutBytes(view.lutReferences[0]!, async bytes => { assert.equal(sha(bytes), sha(f.resource.lut.bytes)); resourceEntered.release(); await release.promise; });
			void resourceChild.catch(() => undefined);
		})); void work.catch(() => undefined);
		try {
			await f.reached(Promise.all([entered.promise, resourceEntered.promise]).then(() => undefined), work);
			closing = manager ? f.scopes.close() : session.close(); assert.equal(manager ? f.scopes.close() : session.close(), closing); assert.equal(await remainsPending(closing), true);
			assert.ok(f.storage.counts().stages > 0); release.release(); await assert.rejects(work); await closing; assert.equal(f.storage.counts().stages, 0);
			await assert.rejects(session.readPage());
		} finally { release.release(); await Promise.allSettled([work, ...(child ? [child] : []), ...(resourceChild ? [resourceChild] : []), ...(closing ? [closing] : [])]); }
	});
});
