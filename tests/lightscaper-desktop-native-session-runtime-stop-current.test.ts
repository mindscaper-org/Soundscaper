/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopPhotoLibrarySessionCurrentV1 as create } from '../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import type { DesktopPhotoLibrarySessionServiceCurrentV1 as Service } from '../src/lightscaper/desktop-photo-library-session-storage-current-v1.ts';
import { nativeSessionRuntimeFixtureCurrentV1 as fixture, remainsPending } from './helpers/lightscaper-desktop-native-session-runtime-integration-fixture-current.ts';

void test('Native public Close synchronously fences actual Current handoff and brush mutation before borrowed request reflection', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		let nativeReads = 0;
		const service: Service = { async open(input, owner) {
			const actual = await f.service.open(input, owner), catalog = actual.components.catalog, read = catalog.readSummaryPage;
			return Object.freeze({ ...actual, components: Object.freeze({ ...actual.components, catalog: Object.freeze({ ...catalog,
				readSummaryPage: (...args: Parameters<typeof read>) => { nativeReads++; return Reflect.apply(read, catalog, args) as ReturnType<typeof read>; },
			}) }) });
		} };
		const session = await f.track(create({ name: 'Actual synchronous Current Close', service, originalSourceOptions: { storage: f.storage.storage } }));
		const collection = session.collectionHandoffCurrent, image = session.imageHandoffCurrent, masks = session.develop.maskRasters;
		assert.ok(collection); assert.ok(image); assert.ok(masks);
		const root = await f.components.catalog.loadCatalog(f.selected.catalogId), photo = f.photos[0]!; assert.ok(root);
		const entered = f.gate(), release = f.gate(); let closing: Promise<void> | undefined;
		const refusals: Promise<unknown>[] = []; let reflections = 0, consumers = 0; const poisonReason = Symbol('late borrowed request');
		const poison = new Proxy({ catalogId: photo.catalogId, photoId: photo.id, versionId: photo.versions[0]!.id, expectedRevision: photo.revision }, {
			get() { reflections++; throw poisonReason; }, ownKeys() { reflections++; throw poisonReason; },
			getOwnPropertyDescriptor() { reflections++; throw poisonReason; }, getPrototypeOf() { reflections++; throw poisonReason; },
		});
		const work = f.track(collection.withCapture({ catalogId: root.id, collectionId: 'manual', scope: 'catalog', expectedCatalogRevision: root.revision },
			view => view.withOriginal(photo.id, async body => { const bytes = new Uint8Array(await body.arrayBuffer()); bytes.fill(0); entered.release(); await release.promise; })));
		void work.catch(() => undefined);
		try {
			await f.reached(entered.promise, work); const priorReads = nativeReads; closing = session.close();
			// No await between public Close and either actual child call. The held
			// consumer keeps physical/native retirement pending throughout probes.
			refusals.push(session.readPage(), image.withCapture(poison, () => { consumers++; }), masks.install(poison, new Uint8Array(0)));
			for (const refusal of refusals) void refusal.catch(() => undefined);
			assert.equal(reflections, 0); assert.equal(consumers, 0);
			for (const refusal of refusals) await assert.rejects(refusal, error => !Object.is(error, poisonReason));
			assert.equal(nativeReads, priorReads, 'The refused top-level page must not reach the actual native catalog.');
			assert.equal(await remainsPending(closing), true); assert.ok(f.storage.counts().stages > 0);
			release.release(); await assert.rejects(work); await closing; assert.equal(f.storage.counts().stages, 0);
		} finally { release.release(); await Promise.allSettled([work, ...refusals, ...(closing ? [closing] : [])]); }
	});
});
