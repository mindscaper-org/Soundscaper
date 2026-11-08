/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PhotoCatalogRestoreDeliveryForProfileV1 } from '../src/lightscaper/catalog/internal/photo-catalog-restore-records-kernel-v1.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { readLightscaperNativePhotoRowCurrentV1, readLightscaperNativeCatalogRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { readLightscaperNativeStackRowCurrentV1 } from './lightscaper-native-stack-records-current-v1.ts';
import { readLightscaperNativeSmartCollectionRowCurrentV1 } from './lightscaper-native-smart-collection-records-current-v1.ts';
import { readLightscaperNativeLegacyQueryRowCurrentV1 } from './lightscaper-native-legacy-query-records-current-v1.ts';
import { readLightscaperNativeQueryRowCurrentV1 } from './lightscaper-native-query-records-current-v1.ts';
import { getLightscaperNativeLegacyQueryBuildCurrentV1 } from './lightscaper-native-legacy-query-write-current-v1.ts';
import { getLightscaperNativeQueryBuildCurrentV1 } from './lightscaper-native-query-write-current-v1.ts';
import { catalogRestoreColumnsCurrentV1 as columns, catalogRestoreEqualCurrentV1 as equal, catalogRestoreTransactionCurrentV1 as transaction,
	checkCatalogRestoreCurrentV1 as check, photoPacket, stackPacket, savedPacket,
	LIGHTSCAPER_NATIVE_CATALOG_RESTORE_TABLES_CURRENT_V1 as TABLES, type LightscaperNativeCatalogRestoreRootCurrentV1 as Root,
	type RestoreTable } from './lightscaper-native-catalog-restore-records-current-v1.ts';

export interface LightscaperNativeCatalogRestoreAuditCountsCurrentV1 { readonly photos: number; readonly stacks: number; readonly saved: number; readonly legacy: number }
type Counts = LightscaperNativeCatalogRestoreAuditCountsCurrentV1;
const keyColumn = (table: RestoreTable): string => table === 'native_photo_catalogs' ? 'id' : table === 'native_photo_memberships' ? 'key'
	: table.startsWith('native_photo_smart_collection') ? table.endsWith('_states') ? 'catalog_id' : 'collection_key'
	: table.includes('_builds_') || table.endsWith('_states') ? 'catalog_id' : table === 'native_photo_stacks' ? 'stack_key' : 'photo_key';
export function readCatalogRestorePointCurrentV1(database: DatabaseSync, table: RestoreTable, key: string) {
	return database.prepare(`SELECT ${columns(table)} FROM ${table} WHERE ${keyColumn(table)}=?`).get(key);
}
export function assertCatalogRestoreControlsCurrentV1(database: DatabaseSync, root: Root, count: Counts, ready: boolean): void {
	const source = readCatalogRestorePointCurrentV1(database, 'native_photo_catalogs', root.root.id);
	if (!source) throw new ReferenceError('Native restored catalog is missing.');
	const current = readLightscaperNativeCatalogRowCurrentV1(source, root.root.id); equal(current.root, root.root); equal(current.index, root.index);
	for (const [version, build] of [[1, getLightscaperNativeLegacyQueryBuildCurrentV1(database, root.root.id)], [2, getLightscaperNativeQueryBuildCurrentV1(database, root.root.id)]] as const) {
		equal(build, { id: root.root.id, schemaVersion: version, ready: ready && (version === 2 || count.legacy === root.root.photoCount), afterKey: null, indexedCount: version === 1 ? count.legacy : count.photos });
	}
	equal(readCatalogRestorePointCurrentV1(database, 'native_photo_stack_states', root.root.id), { catalog_id: root.root.id, revision: 0, stack_count: ready ? count.stacks : 0 });
	equal(readCatalogRestorePointCurrentV1(database, 'native_photo_smart_collection_states', root.root.id), root.savedState ? {
		catalog_id: root.root.id, revision: root.savedState.revision, collection_count: root.savedState.collectionCount,
	} : undefined);
}
/** One native row at a time. Every native cursor is a completed LIMIT1 get;
 * pages yield only after a real transaction has retired. */
async function walk(database: DatabaseSync, table: RestoreTable, signal: AbortSignal, run: (row: Record<string, unknown>) => void | Promise<void>): Promise<void> {
	let after: string | null = null;
	for (;;) {
		const row = transaction(database, signal, false, () => database.prepare(`SELECT ${columns(table)} FROM ${table}
			${after === null ? '' : `WHERE ${keyColumn(table)}>?`} ORDER BY ${keyColumn(table)} LIMIT 1`).get(...(after === null ? [] : [after])));
		if (!row) return;
		const key = row[keyColumn(table)]; if (typeof key !== 'string') throw new TypeError('Native restored key exceeds its scalar bound.');
		after = key; await run(row); check(signal); await nextTurn(); check(signal);
	}
}
async function points<T>(database: DatabaseSync, signal: AbortSignal, values: readonly T[], verify: (value: T, index: number) => void): Promise<void> {
	for (let offset = 0; offset < values.length; offset += 64) {
		transaction(database, signal, false, () => { for (let index = offset; index < Math.min(values.length, offset + 64); index++) { check(signal); verify(values[index]!, index); } });
		await nextTurn(); check(signal);
	}
}
export async function auditLightscaperNativeCatalogRestoreCurrentV1(database: DatabaseSync, root: Root, count: Counts,
	delivery: PhotoCatalogRestoreDeliveryForProfileV1<'current4'>, signal: AbortSignal): Promise<Readonly<Record<RestoreTable, number>>> {
	transaction(database, signal, false, () => assertCatalogRestoreControlsCurrentV1(database, root, count, false));
	if (count.photos !== root.root.photoCount || count.saved !== (root.savedState?.collectionCount ?? 0)) throw new TypeError('Native restore delivery is incomplete.');
	let photos = 0, legacy = 0, memberships = 0, stacks = 0, members = 0, saved = 0;
	await walk(database, 'native_photos', signal, async raw => {
		const photo = readLightscaperNativePhotoRowCurrentV1(raw, root.root.id), packet = photoPacket('current4', root.root, photo); delivery.assertDelivered(photo); photos++;
		if (photos > count.photos) throw new TypeError('Native restored Photo inventory has excess rows.');
		transaction(database, signal, false, () => {
			const row1 = readCatalogRestorePointCurrentV1(database, 'native_photo_query_rows_v1', packet.photo.key);
			if (packet.queryV1 === null) { if (row1 !== undefined) throw new TypeError('Legacy-ineligible restored Photo retained Row1.'); }
			else { if (!row1) throw new ReferenceError('Restored Row1 is missing.'); equal(readLightscaperNativeLegacyQueryRowCurrentV1(row1), packet.queryV1); legacy++; }
			const row2 = readCatalogRestorePointCurrentV1(database, 'native_photo_query_rows_v2', packet.photo.key);
			if (!row2) throw new ReferenceError('Restored Row2 is missing.'); equal(readLightscaperNativeQueryRowCurrentV1(row2), packet.queryV2);
		});
		await points(database, signal, packet.memberships, row => equal(readCatalogRestorePointCurrentV1(database, 'native_photo_memberships', row.key),
			{ key: row.key, scope: row.scope, photo_key: row.photoKey, catalog_id: photo.catalogId })); memberships += packet.memberships.length;
	});
	await walk(database, 'native_photo_stacks', signal, async raw => {
		const stack = readLightscaperNativeStackRowCurrentV1(raw, root.root.id), packet = stackPacket(root.root, stack); delivery.assertDelivered(stack); stacks++;
		if (stacks > count.stacks) throw new TypeError('Native restored Stack inventory has excess rows.');
		await points(database, signal, stack.photoIds, (photoId, position) => {
			const key = photoStorageKey(stack.catalogId, photoId), expected = { photo_key: key, catalog_id: stack.catalogId, photo_id: photoId,
				stack_key: packet.stack.key, stack_id: stack.id, member_position: position };
			if (!database.prepare('SELECT 1 FROM native_photos WHERE photo_key=?').get(key)) throw new ReferenceError('Restored stack source is missing.');
			for (const table of ['native_photo_stack_forward_members', 'native_photo_stack_memberships'] as const) equal(readCatalogRestorePointCurrentV1(database, table, key), expected);
		}); members += stack.photoIds.length;
	});
	await walk(database, 'native_photo_smart_collections', signal, raw => {
		const record = readLightscaperNativeSmartCollectionRowCurrentV1(raw, root.root.id), packet = savedPacket(root.root, record.document); delivery.assertDelivered(record.document); saved++;
		if (saved > count.saved) throw new TypeError('Native restored saved inventory has excess rows.');
		transaction(database, signal, false, () => equal(readCatalogRestorePointCurrentV1(database, 'native_photo_smart_collection_summaries', packet.definition.key), {
			collection_key: packet.definition.key, catalog_id: root.root.id, collection_id: record.document.id,
			revision: record.document.revision, name: JSON.stringify(record.document.name),
		}));
	});
	if (photos !== count.photos || legacy !== count.legacy || stacks !== count.stacks || saved !== count.saved) throw new TypeError('Native restore source inventory differs from delivered records.');
	return Object.freeze({ native_photo_catalogs: 1, native_photos: photos, native_photo_memberships: memberships,
		native_photo_query_rows_v1: legacy, native_photo_query_builds_v1: 1, native_photo_query_rows_v2: photos, native_photo_query_builds_v2: 1,
		native_photo_stacks: stacks, native_photo_stack_states: 1, native_photo_stack_forward_members: members, native_photo_stack_memberships: members,
		native_photo_smart_collections: saved, native_photo_smart_collection_summaries: saved, native_photo_smart_collection_states: root.savedState ? 1 : 0 });
}
export function assertCatalogRestoreCountsCurrentV1(database: DatabaseSync, expected: Readonly<Record<RestoreTable, number>>): void {
	for (const table of Object.keys(TABLES) as RestoreTable[]) {
		if (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n !== expected[table]) throw new TypeError(`Restored ${table} count differs from its authenticated inventory.`);
	}
}
/** Canonical complete physical inventory hash. Row guards apply before each
 * materialization, and no collection of source documents is retained. */
export async function hashCatalogRestoreInventoryCurrentV1(database: DatabaseSync, signal: AbortSignal, count: Counts): Promise<string> {
	const hash = createHash('sha256');
	const frame = (text: string): void => { const bytes = Buffer.from(text, 'utf8'), length = Buffer.alloc(4); length.writeUInt32LE(bytes.byteLength); hash.update(length); hash.update(bytes); };
	for (const table of Object.keys(TABLES) as RestoreTable[]) {
		frame(table); await walk(database, table, signal, raw => {
			const row: Record<string, unknown> = {};
			for (const column of TABLES[table]) {
				const value = raw[column];
				if (value === null && column !== 'after_key') throw new TypeError('Restored inventory has an oversized or invalid scalar.');
				row[column] = value instanceof Uint8Array ? Buffer.from(value).toString('hex') : value;
			}
			if (table === 'native_photo_query_builds_v1') row.ready = count.legacy === count.photos ? 1 : 0;
			if (table === 'native_photo_query_builds_v2') row.ready = 1;
			if (table === 'native_photo_stack_states') row.stack_count = count.stacks;
			frame(JSON.stringify(row));
		});
	}
	return hash.digest('hex');
}
