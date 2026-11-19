/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { canonicalPhotoDocumentJsonV1 as canonical } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { serializePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { serializePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { photoCatalogRestorePhotoRecordsForProfileV1 as photoPacket } from '../src/lightscaper/catalog/internal/photo-catalog-restore-records-kernel-v1.ts';
import { photoCatalogRestoreRootRecordsV1 as rootPacket, photoCatalogRestoreStackRecordsV1 as stackPacket,
	photoCatalogRestoreSavedCollectionRecordsV1 as savedPacket } from '../src/lightscaper/catalog/photo-catalog-restore-records-v1.ts';
import { writeLightscaperNativeLegacyQueryPhotoCurrentV1, writeLightscaperNativeLegacyQueryBuildCurrentV1 } from './lightscaper-native-legacy-query-write-current-v1.ts';
import { writeLightscaperNativeQueryPhotoCurrentV1, writeLightscaperNativeQueryBuildCurrentV1 } from './lightscaper-native-query-write-current-v1.ts';

export { photoPacket, rootPacket, stackPacket, savedPacket };
export type LightscaperNativeCatalogRestoreRootCurrentV1 = ReturnType<typeof rootPacket>;
export const LIGHTSCAPER_NATIVE_CATALOG_RESTORE_TABLES_CURRENT_V1 = Object.freeze({
	native_photo_catalogs: ['id', 'document', 'root_revision', 'photo_count', 'index_revision'],
	native_photos: ['photo_key', 'catalog_id', 'photo_id', 'revision', 'document', 'summary'],
	native_photo_memberships: ['key', 'scope', 'photo_key', 'catalog_id'],
	native_photo_query_rows_v1: ['photo_key', 'catalog_id', 'photo_id', 'photo_revision', 'row_json', 'file_name_key', 'capture_bucket', 'capture_sort', 'rating_sort'],
	native_photo_query_builds_v1: ['catalog_id', 'ready', 'after_key', 'indexed_count'],
	native_photo_query_rows_v2: ['photo_key', 'catalog_id', 'photo_id', 'photo_revision', 'row_json', 'file_name_key', 'capture_bucket', 'capture_sort', 'rating_sort'],
	native_photo_query_builds_v2: ['catalog_id', 'ready', 'after_key', 'indexed_count'],
	native_photo_stacks: ['stack_key', 'catalog_id', 'stack_id', 'revision', 'document', 'photo_count', 'cover_photo_id'],
	native_photo_stack_states: ['catalog_id', 'revision', 'stack_count'],
	native_photo_stack_forward_members: ['photo_key', 'catalog_id', 'photo_id', 'stack_key', 'stack_id', 'member_position'],
	native_photo_stack_memberships: ['photo_key', 'catalog_id', 'photo_id', 'stack_key', 'stack_id', 'member_position'],
	native_photo_smart_collections: ['collection_key', 'catalog_id', 'collection_id', 'revision', 'document', 'reference_keys'],
	native_photo_smart_collection_summaries: ['collection_key', 'catalog_id', 'collection_id', 'revision', 'name'],
	native_photo_smart_collection_states: ['catalog_id', 'revision', 'collection_count'],
} as const);
export type RestoreTable = keyof typeof LIGHTSCAPER_NATIVE_CATALOG_RESTORE_TABLES_CURRENT_V1;
const TEXT: Readonly<Record<string, number>> = { id: 128, catalog_id: 128, photo_id: 128, stack_id: 128, cover_photo_id: 128, collection_id: 128,
	photo_key: 257, stack_key: 257, collection_key: 530, key: 512, scope: 384, summary: 4096, after_key: 257, reference_keys: 80_000, name: 1538, capture_sort: 23 };
const cleanup = new WeakSet<object>(), CHECK = AbortSignal.prototype.throwIfAborted;
export function checkCatalogRestoreCurrentV1(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }
export function catalogRestoreCleanupFailureCurrentV1(value: unknown): boolean { return value !== null && typeof value === 'object' && cleanup.has(value); }
export function catalogRestoreTransactionCurrentV1<Result>(database: DatabaseSync, signal: AbortSignal, writing: boolean, run: () => Result): Result {
	if (database.isTransaction) throw new Error('Native catalog restore requires its own settled transaction.');
	checkCatalogRestoreCurrentV1(signal); database.exec(writing ? 'BEGIN IMMEDIATE' : 'BEGIN');
	try { const result = run(); checkCatalogRestoreCurrentV1(signal); database.exec('COMMIT'); if (!writing) checkCatalogRestoreCurrentV1(signal); return result; }
	catch (primary) { try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (failure) { const combined = new AggregateError([primary, failure], 'Native catalog restore rollback did not retire.', { cause: failure }); cleanup.add(combined); throw combined; } throw primary; }
}
/** SQL guards precede JavaScript materialization, including when SQLite CHECKs
 * were bypassed. Table and column names are fixed owning constants. */
export function catalogRestoreColumnsCurrentV1(table: RestoreTable): string {
	return LIGHTSCAPER_NATIVE_CATALOG_RESTORE_TABLES_CURRENT_V1[table].map(column => {
		const maximum = column === 'document' ? table === 'native_photo_stacks' ? 262_144 : table === 'native_photo_smart_collections' ? 528_384 : 2_097_152
			: column === 'row_json' ? table === 'native_photo_query_rows_v1' ? 524_288 : 1_048_576 : TEXT[column];
		if (column === 'file_name_key') return `CASE WHEN typeof(${column})='blob' AND length(${column})<=2048 THEN ${column} END AS ${column}`;
		return maximum === undefined ? column : `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximum} THEN ${column} END AS ${column}`;
	}).join(',');
}
export function catalogRestoreEqualCurrentV1(actual: unknown, expected: unknown): void {
	if (canonical(actual) !== canonical(expected)) throw new TypeError('Native restored record differs from its exact owning projection.');
}
export function initializeCatalogRestoreCurrentV1(database: DatabaseSync, records: LightscaperNativeCatalogRestoreRootCurrentV1): void {
	for (const table of Object.keys(LIGHTSCAPER_NATIVE_CATALOG_RESTORE_TABLES_CURRENT_V1)) {
		if (database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw new TypeError('Native restore requires genuinely pristine catalog inventory.');
	}
	const { root, savedState } = records;
	database.prepare('INSERT INTO native_photo_catalogs(id,document,root_revision,photo_count,index_revision) VALUES(?,?,?,?,0)')
		.run(root.id, serializeLightscaperDocumentV1(root), root.revision, root.photoCount);
	database.prepare('INSERT INTO native_photo_stack_states(catalog_id,revision,stack_count) VALUES(?,0,0)').run(root.id);
	if (savedState) database.prepare('INSERT INTO native_photo_smart_collection_states(catalog_id,revision,collection_count) VALUES(?,?,?)')
		.run(root.id, savedState.revision, savedState.collectionCount);
	writeLightscaperNativeLegacyQueryBuildCurrentV1(database, records.queryBuildV1); writeLightscaperNativeQueryBuildCurrentV1(database, records.queryBuildV2);
}
export function insertCatalogRestorePhotoCurrentV1(database: DatabaseSync, packet: ReturnType<typeof photoPacket>): void {
	const photo = packet.photo.document;
	database.prepare('INSERT INTO native_photos(photo_key,catalog_id,photo_id,revision,document,summary) VALUES(?,?,?,?,?,?)')
		.run(packet.photo.key, photo.catalogId, photo.id, photo.revision, serializePhotoDocumentCurrentV1(photo), canonical(packet.summary));
	writeLightscaperNativeLegacyQueryPhotoCurrentV1(database, photo, 'insert'); writeLightscaperNativeQueryPhotoCurrentV1(database, photo, 'insert');
}
export function insertCatalogRestoreStackCurrentV1(database: DatabaseSync, packet: ReturnType<typeof stackPacket>): void {
	const stack = packet.stack.document;
	// The maintained engine-owned INSERT trigger writes at most1024 forward
	// members for this one bounded document. Explicit reverse pages stay<=64.
	database.prepare('INSERT INTO native_photo_stacks(stack_key,catalog_id,stack_id,revision,document,photo_count,cover_photo_id) VALUES(?,?,?,?,?,?,?)')
		.run(packet.stack.key, stack.catalogId, stack.id, stack.revision, serializePhotoStackV1(stack), stack.photoIds.length, stack.coverPhotoId);
}
export function insertCatalogRestoreSavedCurrentV1(database: DatabaseSync, packet: ReturnType<typeof savedPacket>): void {
	const { definition, summary } = packet, saved = definition.document;
	database.prepare('INSERT INTO native_photo_smart_collections(collection_key,catalog_id,collection_id,revision,document,reference_keys) VALUES(?,?,?,?,?,?)')
		.run(definition.key, saved.catalogId, saved.id, saved.revision, serializePhotoSmartCollectionV1(saved), JSON.stringify(definition.referenceKeys));
	database.prepare('INSERT INTO native_photo_smart_collection_summaries(collection_key,catalog_id,collection_id,revision,name) VALUES(?,?,?,?,?)')
		.run(summary.key, saved.catalogId, saved.id, saved.revision, JSON.stringify(saved.name));
}
export function catalogRestorePhotoMembershipPageCurrentV1(database: DatabaseSync, packet: ReturnType<typeof photoPacket>, offset: number): void {
	for (const row of packet.memberships.slice(offset, offset + 64)) database.prepare('INSERT INTO native_photo_memberships(key,scope,photo_key,catalog_id) VALUES(?,?,?,?)')
		.run(row.key, row.scope, row.photoKey, packet.photo.document.catalogId);
}
export function catalogRestoreStackMembershipPageCurrentV1(database: DatabaseSync, packet: ReturnType<typeof stackPacket>, offset: number): void {
	const stack = packet.stack.document;
	for (let position = offset; position < Math.min(stack.photoIds.length, offset + 64); position++) {
		const photoId = stack.photoIds[position]!;
		database.prepare('INSERT INTO native_photo_stack_memberships(photo_key,catalog_id,photo_id,stack_key,stack_id,member_position) VALUES(?,?,?,?,?,?)')
			.run(photoStorageKey(stack.catalogId, photoId), stack.catalogId, photoId, packet.stack.key, stack.id, position);
	}
}
