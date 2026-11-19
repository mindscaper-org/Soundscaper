/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { deriveLightscaperNativeCatalogPathsCurrentV1 } from '../../desktop/lightscaper-native-catalog-database-current-v1.ts';
import type { PhotoLibraryCullingNavigationContextV1 } from '../../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import type { PhotoLibraryPageV1 } from '../../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import type { PhotoSummaryV1 } from '../../src/lightscaper/catalog/repository-types.ts';
import { normalizePhotoCatalogQueryV1 } from '../../src/lightscaper/catalog/photo-query-types-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../../src/lightscaper/catalog/photo-query-types-v2.ts';
import { normalizePhotoStackV1 } from '../../src/lightscaper/catalog/photo-stack-v1.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './lightscaper-native-catalog-fixture-current.ts';

export const CATALOG = 'catalog';
const ratingSort = { field: 'rating', direction: 'ascending' };
export const nativeCullingOwnerContextsCurrentV1: readonly (readonly [string, PhotoLibraryCullingNavigationContextV1])[] = [
	['plain', { kind: 'plain' }],
	...([1, 2] as const).flatMap(version => [false, true].map(collapsed => [
		`Query${String(version)} ${collapsed ? 'collapsed' : 'ordinary'}`,
		{ kind: 'query' as const, query: version === 1 ? normalizePhotoCatalogQueryV1({ sort: ratingSort })
			: normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', sort: ratingSort }), collapsed }
	] as const)),
	...[false, true].map(collapsed => [`saved ${collapsed ? 'collapsed' : 'ordinary'}`,
		{ kind: 'saved' as const, collectionId: 'saved', collapsed }] as const)
];
export function nativeCullingOwnerDestinationCurrentV1(store: Store, context: PhotoLibraryCullingNavigationContextV1,
	request: Readonly<{ photoId: string; signal?: AbortSignal }>): Promise<Readonly<PhotoLibraryPageV1> | null> {
	const method: unknown = Reflect.get(store, 'readCullingDestinationPage');
	assert.equal(typeof method, 'function', 'The actual native owner must provide its culling destination reader.');
	return Reflect.apply(method as (...args: unknown[]) => Promise<Readonly<PhotoLibraryPageV1> | null>, store, [CATALOG, context, request]);
}
interface IndexedPage { readonly items: readonly PhotoSummaryV1[]; readonly continuation: unknown }
/** Invoke the genuine existing corresponding reader, retaining its own envelope. */
export function nativeCullingOwnerIndexedPageCurrentV1(store: Store, context: PhotoLibraryCullingNavigationContextV1,
	continuation: unknown = null): Promise<IndexedPage> {
	const name = context.kind === 'plain' ? 'readSummaryPage' : context.kind === 'saved'
		? context.collapsed ? 'readSmartCollectionStackQueryPageV1' : 'readSmartCollectionQueryPageV1'
		: 'schemaVersion' in context.query ? context.collapsed ? 'readStackQueryPageV2' : 'readQueryPageV2'
			: context.collapsed ? 'readStackQueryPage' : 'readQueryPage';
	const method: unknown = Reflect.get(store, name); assert.equal(typeof method, 'function');
	const options = context.kind === 'query' ? { query: context.query, continuation } : { continuation };
	const args = context.kind === 'saved' ? [CATALOG, context.collectionId, options] : [CATALOG, options];
	return Reflect.apply(method as (...args: unknown[]) => Promise<IndexedPage>, store, args);
}
export async function* nativeCullingOwnerBodyCurrentV1() { yield Uint8Array.of(1, 2, 3); }
export function nativeCullingOwnerSqlSnapshotCurrentV1(database: DatabaseSync, tables: readonly string[]) {
	return tables.map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() }));
}
export interface NativeCullingOwnerFixtureOptionsCurrentV1 {
	readonly count?: number;
	readonly groups?: 'pair' | 'sixty-five';
	readonly verifyResources?: (photo: PhotoDocumentCurrentV1, signal?: AbortSignal) => Promise<void>;
}
interface Seeded {
	readonly store: Store;
	readonly database: DatabaseSync;
	readonly directory: string;
	readonly photos: readonly PhotoDocumentCurrentV1[];
	readonly root: NonNullable<Awaited<ReturnType<Store['loadCatalog']>>>;
	readonly indexRevision: number;
}
/** Real bounded owner publications: no raw SQL seeding, synthetic repository,
 * IndexedDB compatibility facade or image decoder substitution. */
export async function nativeCullingOwnerFixtureCurrentV1(run: (value: Seeded) => Promise<void>,
	options: NativeCullingOwnerFixtureOptionsCurrentV1 = {}): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native culling owner ü ')));
	const store = await Store.open({ appDataPath: directory,
		...(options.verifyResources === undefined ? {} : { verifyResources: options.verifyResources }) });
	let database: DatabaseSync | undefined, failed = false, failure: unknown; const cleanup: unknown[] = [];
	try {
		const count = options.count ?? 130, photos = Array.from({ length: count }, (_, index) => nativePhotoCurrentV1(index));
		await store.createCatalog(nativeCatalogRootCurrentV1()); let revision = 0;
		for (const photo of photos) await store.storeOriginal(photo.original, nativeCullingOwnerBodyCurrentV1());
		for (let index = 0; index < photos.length; index += 16) revision = (await store.publishPhotos(CATALOG, revision, photos.slice(index, index + 16))).revision;
		const groups = options.groups === 'sixty-five' ? 65 : count >= 2 ? 1 : 0;
		for (let index = 0; index < groups; index++) {
			const a = options.groups === 'sixty-five' ? index * 2 : count - 2, b = a + 1;
			assert.ok(photos[a] && photos[b]);
			await store.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: CATALOG,
				id: `group-${String(index).padStart(4, '0')}`, revision: 0, photoIds: [photos[a]!.id, photos[b]!.id], coverPhotoId: photos[a]!.id }),
				null, { expectedCatalogRevision: revision, expectedStateRevision: index }); revision++;
		}
		await store.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: CATALOG, id: 'saved',
			name: 'Saved native rating order', revision: 0, query: normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', sort: ratingSort }) },
			null, { expectedCatalogRevision: revision, expectedIndexRevision: revision, expectedStateRevision: 0 });
		const root = await store.loadCatalog(CATALOG), snapshot = await store.readSnapshot(CATALOG); assert.ok(root && snapshot);
		database = new DatabaseSync(deriveLightscaperNativeCatalogPathsCurrentV1(directory).databasePath, { readOnly: true });
		await run({ store, database, directory, photos, root, indexRevision: snapshot.indexRevision });
	} catch (error) { failed = true; failure = error; }
	try { database?.close(); } catch (error) { cleanup.push(error); }
	try { await store.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup, 'Native culling owner fixture retirement failed.');
	if (failed) throw failure;
	// A failed directory stays owned by Root until the whole verification process joins.
	await rm(directory, { recursive: true, force: false });
}
