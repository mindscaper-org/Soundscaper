/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { locks } from 'node:worker_threads';
import type { TestContext } from 'node:test';
import { PhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/controller/photo-library-session-current-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../../src/lightscaper/controller/photo-library-session-ports-current-v1.ts';
import type { PhotoLibraryCollectionHandoffRequestV1 } from '../../src/common/editor/photo-library-collection-handoff-port-v1.ts';
import type { PhotoLibraryCollectionHandoffViewV2 } from '../../src/common/editor/photo-library-collection-handoff-port-v2.ts';
import type { PhotoLibraryOriginalRequestCurrentV1 as Request } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { DesktopPhotoOriginalSourceCurrentV1 } from '../../src/lightscaper/desktop-photo-original-source-current-v1.ts';
import type { DesktopPhotoOriginalTransportCurrentV1 as Transport } from '../../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoCatalogQueryV2 } from '../../src/lightscaper/catalog/photo-query-types-v2.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { nativeScopeIntegrationFixtureCurrentV1, scopePhotoCurrentV1, scopeCatalogRootCurrentV1,
	scopeResourceBundleCurrentV1, installScopeResourceBundleCurrentV1, scopeResourcePhotoCurrentV1,
	scopeOriginalReferenceCurrentV1 as reference, type ComponentsCurrentV1 } from './lightscaper-native-library-scope-integration-fixture-current.ts';
import { originalGroupFixtureCurrentV1 } from './lightscaper-desktop-original-group-fixture-current.ts';
export { remainsPending } from './async-test-control.ts';
export const scopedCollectionNativeShaCurrentV1 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const exclusive: NonNullable<PhotoLibrarySessionPortsCurrentV1['exclusive']> = async (catalogId, run, signal) => {
	const outcome = await locks.request(`lightscaper-photo-catalog:${catalogId}`, { mode: 'exclusive', ...(signal ? { signal } : {}) }, async lock => {
		try { assert.ok(lock); signal?.throwIfAborted(); return { okay: true as const, value: await run(signal) }; }
		catch (error) { return { okay: false as const, error }; }
	});
	if (!outcome.okay) throw outcome.error; return outcome.value;
};

/** Actual guarded native library, SQL catalog/settings/custody/resource/body
 * owners and actual group tickets feed the production renderer source. Only
 * OPFS directory operations are bounded test ports; snapshots are native File.
 * No decoder, verifier, Main transport or selected-library owner is replaced. */
export async function scopedCollectionNativeFixtureCurrentV1(context: TestContext,
	run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>): Promise<void> {
	await nativeScopeIntegrationFixtureCurrentV1(async native => {
		const selected = await native.scopes.openDefault(), components = await native.scopes.openComponents(selected);
		await seed(components); const fixture = await createFixture(context, components);
		let failed = false, primary: unknown;
		try { await run(fixture); } catch (error) { failed = true; primary = error; }
		try { await fixture.close(); } catch (cleanup) {
			if (failed && !Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Native collection test and real retirement failed.', { cause: cleanup }); throw cleanup;
		}
		if (failed) throw primary;
	});
}

async function seed(c: Readonly<ComponentsCurrentV1>): Promise<void> {
	const root = normalizePhotoCatalogRootV1({ ...scopeCatalogRootCurrentV1(), collections: [
		{ id: 'manual', name: 'Native complete collection', kind: 'manual' },
		{ id: 'smart', name: 'Native rating collection', kind: 'smart', query: { kind: 'rating', minimum: 4, maximum: 5 } },
	] });
	await c.catalog.createCatalog(root);
	const bundles = [] as Awaited<ReturnType<typeof scopeResourceBundleCurrentV1>>[];
	for (let index = 0; index < 6; index++) { const bundle = await scopeResourceBundleCurrentV1(index); await installScopeResourceBundleCurrentV1(c.resources, bundle); bundles.push(bundle); }
	const rich = scopeResourcePhotoCurrentV1(bundles), photos = [] as ReturnType<typeof normalizePhotoDocumentCurrentV1>[];
	for (let index = 0; index < 6; index++) {
		const entry = scopePhotoCurrentV1(index < 4 ? 1 : 3), storageKey = index < 3 ? 'collection-shared' : index === 3 ? 'collection-alias' : 'collection-distinct';
		if (index === 0 || index === 3 || index === 4) await c.media.writeAsset(storageKey, entry.blob, { name: entry.photo.original.name, mimeType: entry.blob.type });
		const base = index === 0 ? rich : entry.photo;
		photos.push(normalizePhotoDocumentCurrentV1({ ...base, id: `collection-photo-${index}`, collectionIds: ['manual'], rating: 4,
			original: { ...entry.photo.original, id: `collection-source-${index}`, name: `Collection ${index}.dng`, storageKey },
			metadata: { ...base.metadata, fileName: `Collection ${index}.dng` } }));
	}
	await c.media.catalogOriginals.retain(root.id, photos.map(photo => reference(photo.original, photo.id)));
	await c.catalog.publishPhotos(root.id, root.revision, photos);
	const snapshot = await c.catalog.readSmartCollectionSnapshotV1(root.id, null);
	await c.catalog.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id, id: 'saved', revision: 0,
		name: 'Native descending all aliases', query: normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query',
			sort: { field: 'photo-id', direction: 'descending' } }) }, null,
	{ expectedCatalogRevision: snapshot.context.catalogRevision, expectedIndexRevision: snapshot.context.indexRevision,
		expectedStateRevision: snapshot.context.collectionStateRevision });
}

async function createFixture(context: TestContext, c: Readonly<ComponentsCurrentV1>) {
	const active = new Set<Promise<unknown>>(), gates = new Set<() => void>();
	const requests: Readonly<Request>[][] = [], files: File[] = [], reads: number[] = [];
	let opens = 0, closes = 0, singles = 0;
	const actual = c.originalTickets.transport, openGroup = actual.openGroup, readGroup = actual.readGroup, closeGroup = actual.closeGroup;
	assert.equal(typeof openGroup, 'function', 'Real native ticket server must expose group admission after actual publication.');
	assert.equal(typeof readGroup, 'function'); assert.equal(typeof closeGroup, 'function');
	const storage = originalGroupFixtureCurrentV1(context);
	const transport: Transport = {
		open(value) { singles++; return Reflect.apply(actual.open, actual, [value]) as Promise<unknown>; },
		read(value, offset, length) { return Reflect.apply(actual.read, actual, [value, offset, length]) as Promise<unknown>; },
		close(value) { return Reflect.apply(actual.close, actual, [value]) as Promise<void>; },
		openGroup(values) { opens++; requests.push([...values]); return Reflect.apply(openGroup!, actual, [values]) as Promise<unknown>; },
		readGroup(value, index, offset, length) { reads.push(index); return Reflect.apply(readGroup!, actual, [value, index, offset, length]) as Promise<unknown>; },
		async closeGroup(value) { await Reflect.apply(closeGroup!, actual, [value]); closes++; },
	};
	storage.hooks.file = file => { assert.ok(file instanceof File); files.push(file); return file; };
	const source = new DesktopPhotoOriginalSourceCurrentV1(transport, { storage: storage.storage });
	const initialize = async () => { const root = await c.catalog.loadCatalog('catalog-1'); assert.ok(root); return root; };
	const root = await initialize(), photos = [] as ReturnType<typeof normalizePhotoDocumentCurrentV1>[];
	for (let index = 0; index < 6; index++) { const photo = await c.catalog.loadPhoto(root.id, `collection-photo-${index}`); assert.ok(photo); photos.push(photo); }
	const session = new PhotoLibrarySessionCurrentV1({ catalog: c.catalog, smartCollections: c.catalog, originalSource: source,
		media: { writeAsset: c.media.writeAsset, custody: c.media.catalogOriginals }, journal: c.settings.settingsRepository, initialize, exclusive,
		cubeLutResources: c.resources.cubeLutResources, maskRasterResources: c.resources.maskRasterResources,
		verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, c.resources, signal),
		// Parent scope owns the physical components. The fixture first joins this
		// Session and its File consumers, then renderer stages, then the parent.
		closeResources: async (): Promise<void> => undefined });
	const release = (): void => { for (const done of gates) done(); };
	const cancel = (): void => { release(); void session.close().catch(() => undefined); };
	context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	let closing: Promise<void> | undefined;
	return { components: c, session, source, storage, files, requests, reads, photos,
		counts: () => ({ opens, closes, singles, stages: storage.counts().stages }),
		binding(kind: 'manual' | 'smart' | 'saved' = 'manual'): Readonly<PhotoLibraryCollectionHandoffRequestV1> {
			return { catalogId: root.id, collectionId: kind, scope: kind === 'saved' ? 'saved-query' : 'catalog',
				expectedCatalogRevision: root.revision, ...(kind === 'saved' ? { expectedDefinitionRevision: 0 } : {}) };
		},
		gate() { const gate = storage.gate(); gates.add(gate.release); return gate; },
		async reached(barrier: Promise<void>, work: Promise<unknown>): Promise<void> {
			context.signal.throwIfAborted(); await Promise.race([barrier, work.then(() => { throw new Error('Actual native collection ended before barrier.'); })]); context.signal.throwIfAborted();
		},
		capture<Value>(consume: (view: Readonly<PhotoLibraryCollectionHandoffViewV2>) => Value | Promise<Value>,
			options: Readonly<{ signal?: AbortSignal }> = {}, kind: 'manual' | 'smart' | 'saved' = 'manual'): Promise<Value> {
			assert.ok(session.collectionHandoffCurrent);
			const work = session.collectionHandoffCurrent.withCapture(this.binding(kind), consume, options); active.add(work);
			void work.then(() => { active.delete(work); }, () => { active.delete(work); }); return work;
		},
		async roots(storageKey: string, retain: boolean): Promise<void> {
			const matching = photos.filter(photo => photo.original.storageKey === storageKey);
			if (retain) await c.media.catalogOriginals.retain(root.id, matching.map(photo => reference(photo.original, photo.id)));
			else await c.media.catalogOriginals.release(root.id, matching.map(photo => photo.id));
		},
		close(): Promise<void> {
			closing ??= Promise.resolve().then(async () => {
				context.signal.removeEventListener('abort', cancel); release(); const errors: unknown[] = [];
				try { await session.close(); } catch (error) { errors.push(error); }
				await Promise.allSettled([...active]);
				for (const owner of [source, storage, c]) { try { await owner.close(); } catch (error) { errors.push(error); } }
				if (errors.length) throw new AggregateError(errors, 'Native collection fixture retirement is unproved.');
			}); return closing;
		},
	};
}
