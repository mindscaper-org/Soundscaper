/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readValidatedPhotoCatalogRootV1, serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { readPhotoDerivedPublicationGuardCurrentV1, type PhotoDerivedPublicationGuardCurrentV1 } from '../src/lightscaper/catalog/photo-derived-publication-current-v1.ts';
import { validatePhotoCatalogReferencesV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { filterScope, indexState, photoMemberships, photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { id, integer } from '../src/lightscaper/catalog/value-validation.ts';
import { readLightscaperNativeCatalogRowCurrentV1, readLightscaperNativePhotoRowCurrentV1 } from './lightscaper-native-catalog-database-current-v1.ts';
import { readLightscaperNativeCatalogPhotoAdmissionCurrentV1 } from './lightscaper-native-catalog-admission-current-v1.ts';
import { withProjectLibraryImmediateTransaction } from './project-library-immediate-transaction.ts';
import { getLightscaperNativeQueryBuildCurrentV1, writeLightscaperNativeQueryBuildCurrentV1, writeLightscaperNativeQueryPhotoCurrentV1 } from './lightscaper-native-query-write-current-v1.ts';
import { getLightscaperNativeLegacyQueryBuildCurrentV1, writeLightscaperNativeLegacyQueryBuildCurrentV1,
	writeLightscaperNativeLegacyQueryPhotoCurrentV1 } from './lightscaper-native-legacy-query-write-current-v1.ts';

type Catalog = ReturnType<typeof readLightscaperNativeCatalogRowCurrentV1>;
const ROOT_COLUMNS = 'id, document, root_revision, photo_count, index_revision';
const PHOTO_COLUMNS = 'photo_key, catalog_id, photo_id, revision, document, summary';

/** Synchronous main-private transactions. The enclosing owner queues operations,
 * checks cancellation before calling, and preserves a committed return value
 * across later cancellation. These functions never await inside SQLite. */
export function createLightscaperNativeCatalogCurrentV1(database: DatabaseSync, value: unknown): void {
	const root = supportedRoot(value);
	if (root.revision !== 0 || root.photoCount !== 0) throw new RangeError('A new catalog requires revision zero and no photos.');
	withProjectLibraryImmediateTransaction(database, () => {
		if (loadLightscaperNativeCatalogCurrentV1(database, root.id)) throw new RangeError('Photo catalog already exists.');
		database.prepare('INSERT INTO native_photo_catalogs (id, document, root_revision, photo_count, index_revision) VALUES (?, ?, ?, ?, ?)')
			.run(root.id, serializeLightscaperDocumentV1(root), root.revision, root.photoCount, 0);
		writeLightscaperNativeQueryBuildCurrentV1(database, { id: root.id, schemaVersion: 2, ready: true, afterKey: null, indexedCount: 0 });
		writeLightscaperNativeLegacyQueryBuildCurrentV1(database, { id: root.id, schemaVersion: 1, ready: true, afterKey: null, indexedCount: 0 });
		database.prepare('INSERT INTO native_photo_stack_states (catalog_id,revision,stack_count) VALUES (?,0,0)').run(root.id);
	});
}

export function loadLightscaperNativeCatalogCurrentV1(database: DatabaseSync, catalogId: unknown): PhotoCatalogRootV1 | null {
	return catalog(database, id(catalogId, 'catalog ID'))?.root ?? null;
}
export function loadLightscaperNativePhotoCurrentV1(database: DatabaseSync, catalogId: unknown, photoId: unknown): PhotoDocumentCurrentV1 | null {
	const owner = id(catalogId, 'catalog ID'), selected = id(photoId, 'photo ID');
	const row = database.prepare(`SELECT ${PHOTO_COLUMNS} FROM native_photos WHERE photo_key = ?`).get(photoStorageKey(owner, selected));
	return row === undefined ? null : readLightscaperNativePhotoRowCurrentV1(row, owner, selected);
}

export function publishLightscaperNativePhotosCurrentV1(database: DatabaseSync, catalogId: unknown, expectedRevision: unknown,
	admission: unknown): PhotoCatalogRootV1 {
	return publish(database, catalogId, expectedRevision, admission);
}
export function publishDerivedLightscaperNativePhotoCurrentV1(database: DatabaseSync, catalogId: unknown, expectedRevision: unknown,
	guardValue: unknown, admission: unknown): PhotoCatalogRootV1 {
	return publish(database, catalogId, expectedRevision, admission, readPhotoDerivedPublicationGuardCurrentV1(guardValue));
}

export function saveLightscaperNativePhotoCurrentV1(database: DatabaseSync, admission: unknown, expectedRevision: unknown): PhotoDocumentCurrentV1 {
	const photos = readLightscaperNativeCatalogPhotoAdmissionCurrentV1(admission, database, 'edit');
	const photo = photos[0]!, expected = revision(expectedRevision);
	if (photos.length !== 1 || photo.revision !== expected) throw new RangeError('Photo candidate revision disagrees with its expected revision.');
	const next = normalizePhotoDocumentCurrentV1({ ...photo, revision: expected + 1 });
	return withProjectLibraryImmediateTransaction(database, () => {
		const current = requiredCatalog(database, photo.catalogId);
		validatePhotoCatalogReferencesV1(photo, current.root);
		const previous = loadLightscaperNativePhotoCurrentV1(database, photo.catalogId, photo.id);
		if (!previous) throw new ReferenceError('Photo is missing.');
		if (previous.revision !== expected) throw new PhotoCatalogRevisionConflictError('photo');
		if (previous.schemaVersion > photo.schemaVersion) throw new RangeError('A Photo aggregate cannot be downgraded.');
		if (JSON.stringify(previous.original) !== JSON.stringify(photo.original)) throw new RangeError('Photo edits cannot mutate the original.');
		if (JSON.stringify(previous.extractedMetadata) !== JSON.stringify(photo.extractedMetadata)) throw new RangeError('Photo edits cannot mutate extracted metadata.');
		writePhoto(database, next, expected);
		writeRoot(database, current, current.root);
		return next;
	});
}

export function saveLightscaperNativeCatalogCurrentV1(database: DatabaseSync, value: unknown, expectedRevision: unknown): PhotoCatalogRootV1 {
	const candidate = supportedRoot(value), expected = revision(expectedRevision);
	if (candidate.revision !== expected) throw new RangeError('Catalog candidate revision disagrees with its expected revision.');
	const next = readValidatedPhotoCatalogRootV1({ ...candidate, revision: expected + 1 });
	return withProjectLibraryImmediateTransaction(database, () => {
		const current = requiredCatalog(database, candidate.id), previous = current.root;
		supportedRoot(previous);
		if (previous.revision !== expected) throw new PhotoCatalogRevisionConflictError('catalog');
		if (candidate.photoCount !== previous.photoCount) throw new RangeError('Only photo publication changes the catalog photo count.');
		// Saved smart definitions still require their native companion owner.
		const folders = new Set(candidate.folders.map(node => node.id)), keywords = new Set(candidate.keywords.map(node => node.id));
		const collections = new Set(candidate.collections.filter(node => node.kind === 'manual').map(node => node.id));
		const removals = [
			...previous.folders.filter(node => !folders.has(node.id)).map(node => ({ kind: 'folder' as const, id: node.id })),
			...previous.keywords.filter(node => !keywords.has(node.id)).map(node => ({ kind: 'keyword' as const, id: node.id })),
			...previous.collections.filter(node => node.kind === 'manual' && !collections.has(node.id)).map(node => ({ kind: 'collection' as const, id: node.id })),
		];
		for (const filter of removals) {
			if (database.prepare('SELECT key FROM native_photo_memberships WHERE scope = ? LIMIT 1').get(filterScope(previous.id, filter)) !== undefined) {
				throw new ReferenceError('Cannot remove a hierarchy or manual collection still referenced by photos.');
			}
		}
		writeRoot(database, current, next); return next;
	});
}

function publish(database: DatabaseSync, catalogId: unknown, expectedRevision: unknown, admission: unknown,
	guard?: Readonly<PhotoDerivedPublicationGuardCurrentV1>): PhotoCatalogRootV1 {
	const rootId = id(catalogId, 'catalog ID'), expected = revision(expectedRevision);
	const photos = readLightscaperNativeCatalogPhotoAdmissionCurrentV1(admission, database, 'import');
	for (const photo of photos) if (photo.catalogId !== rootId || photo.revision !== 0) throw new RangeError('Imported Photos require the selected catalog and initial revision zero.');
	if (guard && (guard.catalogId !== rootId || photos.length !== 1 || guard.resultPhotoId !== photos[0]!.id)) throw new TypeError('Derived authority requires its single Current result and selected catalog.');
	return withProjectLibraryImmediateTransaction(database, () => {
		const current = requiredCatalog(database, rootId);
		if (current.root.revision !== expected) throw new PhotoCatalogRevisionConflictError('catalog');
		if (guard) for (const selection of guard.selections) {
			const source = loadLightscaperNativePhotoCurrentV1(database, rootId, selection.photoId);
			if (!source) throw new ReferenceError('A selected source Photo is missing.');
			if (source.revision !== selection.revision || JSON.stringify(source.original) !== JSON.stringify(selection.original)) throw new PhotoCatalogRevisionConflictError('photo');
		}
		for (const photo of photos) {
			validatePhotoCatalogReferencesV1(photo, current.root);
			if (database.prepare('SELECT photo_key FROM native_photos WHERE photo_key = ?').get(photoStorageKey(rootId, photo.id)) !== undefined) throw new RangeError('Photo already exists in this catalog.');
		}
		const next = readValidatedPhotoCatalogRootV1({ ...current.root, revision: current.root.revision + 1, photoCount: current.root.photoCount + photos.length });
		for (const photo of photos) writePhoto(database, photo);
		writeRoot(database, current, next); return next;
	});
}
function catalog(database: DatabaseSync, catalogId: string): Catalog | null {
	const row = database.prepare(`SELECT ${ROOT_COLUMNS} FROM native_photo_catalogs WHERE id = ?`).get(catalogId);
	return row === undefined ? null : readLightscaperNativeCatalogRowCurrentV1(row, catalogId);
}
function requiredCatalog(database: DatabaseSync, catalogId: string): Catalog {
	const current = catalog(database, catalogId); if (!current) throw new ReferenceError('Photo catalog is missing.');
	const build = getLightscaperNativeQueryBuildCurrentV1(database, catalogId);
	// Check once before a batch mutates rows. During insertion its derived count
	// legitimately advances before the same transaction publishes the new root.
	if (!build || build.indexedCount > current.root.photoCount || build.ready && build.indexedCount !== current.root.photoCount) {
		throw new TypeError('Native query build count disagrees with its catalog.');
	}
	const legacy = getLightscaperNativeLegacyQueryBuildCurrentV1(database, catalogId);
	if (!legacy || legacy.indexedCount > current.root.photoCount || legacy.ready && legacy.indexedCount !== current.root.photoCount) {
		throw new TypeError('Native legacy query build count disagrees with its catalog.');
	}
	return current;
}
function writeRoot(database: DatabaseSync, previous: Catalog, root: PhotoCatalogRootV1): void {
	const state = indexState(root, previous.index.indexRevision + 1);
	const result = database.prepare('UPDATE native_photo_catalogs SET document = ?, root_revision = ?, photo_count = ?, index_revision = ? WHERE id = ? AND root_revision = ? AND index_revision = ?')
		.run(serializeLightscaperDocumentV1(root), root.revision, root.photoCount, state.indexRevision, root.id, previous.root.revision, previous.index.indexRevision);
	if (result.changes !== 1) throw new PhotoCatalogRevisionConflictError('catalog');
}
function writePhoto(database: DatabaseSync, photo: PhotoDocumentCurrentV1, expectedRevision?: number): void {
	const key = photoStorageKey(photo.catalogId, photo.id), document = serializePhotoDocumentCurrentV1(photo), summary = JSON.stringify(photoSummary(photo));
	if (expectedRevision === undefined) database.prepare('INSERT INTO native_photos (photo_key, catalog_id, photo_id, revision, document, summary) VALUES (?, ?, ?, ?, ?, ?)')
		.run(key, photo.catalogId, photo.id, photo.revision, document, summary);
	else {
		const result = database.prepare('UPDATE native_photos SET revision = ?, document = ?, summary = ? WHERE photo_key = ? AND revision = ?')
			.run(photo.revision, document, summary, key, expectedRevision);
		if (result.changes !== 1) throw new PhotoCatalogRevisionConflictError('photo');
		database.prepare('DELETE FROM native_photo_memberships WHERE photo_key = ?').run(key);
	}
	for (const membership of photoMemberships(photo)) database.prepare('INSERT INTO native_photo_memberships (key, scope, photo_key, catalog_id) VALUES (?, ?, ?, ?)')
		.run(membership.key, membership.scope, membership.photoKey, photo.catalogId);
	const mode = expectedRevision === undefined ? 'insert' : 'replace';
	writeLightscaperNativeLegacyQueryPhotoCurrentV1(database, photo, mode);
	writeLightscaperNativeQueryPhotoCurrentV1(database, photo, mode);
}
function revision(value: unknown): number { return integer(value, 0, Number.MAX_SAFE_INTEGER, 'expected revision'); }

function supportedRoot(value: unknown): PhotoCatalogRootV1 {
	const root = readValidatedPhotoCatalogRootV1(value);
	if (root.collections.some(collection => collection.kind === 'smart')) throw new TypeError('Native smart collections require an unsupported companion owner.');
	return root;
}
