/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { normalizePhotoStackV1, PHOTO_STACK_LIMITS_V1 as LIMITS, type PhotoStackStateV1, type PhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import type { PhotoCatalogIndexStateV1 } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';
import { readLightscaperNativeCatalogRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { getLightscaperNativeQueryBuildCurrentV1 } from './lightscaper-native-query-write-current-v1.ts';
import { readLightscaperNativeStackMemberRowCurrentV1, readLightscaperNativeStackRowCurrentV1,
	readLightscaperNativeStackStateRowCurrentV1 } from './lightscaper-native-stack-records-current-v1.ts';

export interface LightscaperNativeStackContextCurrentV1 {
	readonly root: Readonly<PhotoCatalogRootV1>;
	readonly index: Readonly<PhotoCatalogIndexStateV1>;
	readonly state: Readonly<PhotoStackStateV1>;
}
export const LIGHTSCAPER_NATIVE_STACK_COLUMNS_CURRENT_V1 = 'stack_key,catalog_id,stack_id,revision,document,photo_count,cover_photo_id';
export const LIGHTSCAPER_NATIVE_STACK_MEMBER_COLUMNS_CURRENT_V1 = 'photo_key,catalog_id,photo_id,stack_key,stack_id,member_position';
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

/** Caller owns one read snapshot or immediate write transaction. Root/index,
 * derived-index scalar state and retained grouping state are captured once. */
export function captureLightscaperNativeStackContextCurrentV1(database: DatabaseSync, catalogId: unknown): Readonly<LightscaperNativeStackContextCurrentV1> {
	requireTransaction(database); const catalog = id(catalogId, 'stack catalog ID');
	const raw = database.prepare('SELECT id,document,root_revision,photo_count,index_revision FROM native_photo_catalogs WHERE id=?').get(catalog);
	if (raw === undefined) throw new ReferenceError('Photo catalog is missing.');
	const { root, index } = readLightscaperNativeCatalogRowCurrentV1(raw, catalog);
	const query = getLightscaperNativeQueryBuildCurrentV1(database, catalog);
	if (!query || query.indexedCount > root.photoCount || (query.ready && query.indexedCount !== root.photoCount)) throw new TypeError('Stack catalog Query2 build count is missing or inconsistent.');
	const rawState = database.prepare('SELECT catalog_id,revision,stack_count FROM native_photo_stack_states WHERE catalog_id=?').get(catalog);
	if (rawState === undefined) throw new TypeError('Native stack state is missing.');
	const state = readLightscaperNativeStackStateRowCurrentV1(rawState, catalog);
	if (state.stackCount > Math.floor(root.photoCount / 2)) throw new TypeError('Stack state count exceeds its catalog source capacity.');
	if (state.stackCount === 0) assertLightscaperNativeEmptyStackStateCurrentV1(database, catalog);
	return Object.freeze({ root, index, state });
}

/** Both admission and a transition to zero must prove physical absence through
 * indexed existence probes, without scanning a catalog or repairing counters. */
export function assertLightscaperNativeEmptyStackStateCurrentV1(database: DatabaseSync, catalogId: string): void {
	requireTransaction(database); const catalog = id(catalogId, 'empty stack catalog ID');
	for (const table of ['native_photo_stacks', 'native_photo_stack_forward_members', 'native_photo_stack_memberships']) {
		if (database.prepare(`SELECT 1 FROM ${table} WHERE catalog_id=? LIMIT 1`).get(catalog) !== undefined) throw new TypeError('Empty stack state has retained grouping rows.');
	}
}

/** Read exactly one bounded native document; no nested transaction or global
 * grouping scan. A missing parent cannot silently retain either relation. */
export function readLightscaperNativeStackInTransactionCurrentV1(database: DatabaseSync, catalogId: unknown, stackId: unknown): Readonly<PhotoStackV1> | null {
	requireTransaction(database);
	const catalog = id(catalogId, 'stack catalog ID'), selected = id(stackId, 'stack ID'), key = photoStorageKey(catalog, selected);
	const raw = database.prepare(`SELECT ${LIGHTSCAPER_NATIVE_STACK_COLUMNS_CURRENT_V1} FROM native_photo_stacks WHERE stack_key=?`).get(key);
	if (raw !== undefined) return readLightscaperNativeStackRowCurrentV1(raw, catalog, selected);
	for (const table of ['native_photo_stack_forward_members', 'native_photo_stack_memberships']) {
		if (database.prepare(`SELECT 1 FROM ${table} WHERE stack_key=? LIMIT 1`).get(key) !== undefined) throw new TypeError('Absent stack has retained grouping membership.');
	}
	return null;
}

/** The caller supplies an already admitted native stack and native signal.
 * Authenticate the actual parent, both independently owned ordered relations,
 * and every scalar source key. Photo/Develop/Original bodies are never read. */
export function authenticateLightscaperNativeStackCurrentV1(database: DatabaseSync, value: Readonly<PhotoStackV1>, signal?: AbortSignal): void {
	requireTransaction(database); check(signal);
	const stack = normalizePhotoStackV1(value);
	const stored = readLightscaperNativeStackInTransactionCurrentV1(database, stack.catalogId, stack.id);
	if (!stored || JSON.stringify(stored) !== JSON.stringify(stack)) throw new TypeError('Stack authentication belongs to another stored document.');
	const key = photoStorageKey(stack.catalogId, stack.id);
	for (const table of ['native_photo_stack_forward_members', 'native_photo_stack_memberships']) {
		const rows = database.prepare(`SELECT ${LIGHTSCAPER_NATIVE_STACK_MEMBER_COLUMNS_CURRENT_V1} FROM ${table} WHERE stack_key=? ORDER BY member_position LIMIT ?`)
			.all(key, LIMITS.maximumPhotos + 1);
		if (rows.length !== stack.photoIds.length) throw new TypeError('Stack forward or reverse membership count disagrees with its document.');
		for (let position = 0; position < rows.length; position++) {
			check(signal); const row = readLightscaperNativeStackMemberRowCurrentV1(rows[position], stack.catalogId);
			if (row.stackKey !== key || row.stackId !== stack.id || row.memberPosition !== position || row.photoId !== stack.photoIds[position]) {
				throw new TypeError('Stack forward or reverse ordered membership disagrees with its document.');
			}
		}
	}
	for (const photoId of stack.photoIds) { check(signal); assertLightscaperNativeStackSourceCurrentV1(database, stack.catalogId, photoId); }
	check(signal);
}

export function assertLightscaperNativeStackSourceCurrentV1(database: DatabaseSync, catalogId: string, photoId: string): void {
	requireTransaction(database); const key = photoStorageKey(catalogId, photoId);
	const row = database.prepare('SELECT photo_key,catalog_id,photo_id FROM native_photos WHERE photo_key=?').get(key);
	if (row === undefined) throw new ReferenceError('Stack member photo is missing.');
	if (row.photo_key !== key || row.catalog_id !== catalogId || row.photo_id !== photoId) throw new TypeError('Stack source identity disagrees with its native key.');
}
function requireTransaction(database: DatabaseSync): void { if (!database.isTransaction) throw new Error('Native stack authentication requires one caller transaction snapshot.'); }
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
