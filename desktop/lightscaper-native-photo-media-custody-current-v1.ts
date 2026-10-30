/* SPDX-License-Identifier: AGPL-3.0-only */

import { LIGHTSCAPER_NATIVE_PHOTO_MEDIA_IDENTITY_JOIN_CURRENT_V1 as IDENTITY_JOIN, LIGHTSCAPER_NATIVE_PHOTO_MEDIA_IDENTITY_COLUMNS_CURRENT_V1 as IDENTITY_COLUMNS } from './lightscaper-native-photo-media-identity-current-v1.ts';
import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { CATALOG_ORIGINAL_PAGE_SIZE, CATALOG_ORIGINAL_ROOT_MAX_BYTES, catalogOriginalId, catalogOriginalKey,
	catalogOriginalPhotoIds, catalogOriginalReferences, catalogOriginalScope, normalizeCatalogOriginalRoot,
	type CatalogOriginalReferenceV1, type CatalogOriginalRootV1 } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { isMediaContentSha256, isMediaContentToken } from '../src/common/editor/storage/media-content-provenance.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 as MAXIMUM,
	readLightscaperNativeOriginalStorageKeyCurrentV1 as readKey } from './lightscaper-native-original-contract-current-v1.ts';

type Method = 'retain' | 'stage' | 'release' | 'releaseStaged' | 'promote' | 'readPage' | 'findDigestPage' | 'findManagedDigestPage';
type Base = Readonly<{ signal?: AbortSignal }>;
export type LightscaperNativePhotoCustodyRequestCurrentV1 = Base & (
	| Readonly<{ method: 'retain' | 'stage'; catalogId: string; importId: string | null; references: readonly CatalogOriginalReferenceV1[] }>
	| Readonly<{ method: 'release' | 'releaseStaged' | 'promote'; catalogId: string; importId: string | null; photoIds: readonly string[] }>
	| Readonly<{ method: 'readPage'; catalogId: string; importId: string | null; afterKey: string | null }>
	| Readonly<{ method: 'findDigestPage' | 'findManagedDigestPage'; sha256: string; afterAssetId: string | null }>);
export interface LightscaperNativePhotoCustodyRootPageCurrentV1 {
	readonly roots: readonly Readonly<CatalogOriginalRootV1>[]; readonly afterKey: string | null;
}
export interface LightscaperNativePhotoCustodyDigestPageCurrentV1 {
	readonly matches: readonly Readonly<{ assetId: string; sha256: string; size: number }>[]; readonly afterAssetId: string | null;
}
type Result = void | LightscaperNativePhotoCustodyRootPageCurrentV1 | LightscaperNativePhotoCustodyDigestPageCurrentV1;
type Asset = Readonly<{ key: string; sha256: string; size: number; token: string; count: number }>;
type SqlRow = Record<string, unknown>;
const admitted = new WeakSet<object>(), CHECK = AbortSignal.prototype.throwIfAborted;
const ASSET = `SELECT a.source_id,a.sha256,a.size,a.media_content_token,a.root_count,
	${IDENTITY_COLUMNS}
	FROM native_photo_media_assets a ${IDENTITY_JOIN}`;
const ROOT_COLUMNS = 'root_key,scope_key,asset_id,root';

/** Called after the owner's queue/placeholder registration. Cancellation is
 * captured and checked before any borrowed identities or reference arrays. */
export function captureLightscaperNativePhotoCustodyRequestCurrentV1(method: Method, args: readonly unknown[]): LightscaperNativePhotoCustodyRequestCurrentV1 {
	let signal: AbortSignal | undefined;
	try {
		const offset = method === 'readPage' ? 1 : method === 'stage' || method === 'releaseStaged' || method === 'promote' ? 3 : 2;
		const options = record(args[offset] === undefined ? {} : args[offset], 'native Photo custody options', ['signal'], []);
		const value = Object.hasOwn(options, 'signal') ? field(options, 'signal', 'native Photo custody options') : undefined;
		if (value !== undefined) { assertPhotoStackQuerySignalV1(value); signal = value; }
		check(signal);
		readClosedDomainArray(args, 'native Photo custody arguments', (method === 'findDigestPage' || method === 'findManagedDigestPage') ? 1 : offset, offset + 1);
		let captured: LightscaperNativePhotoCustodyRequestCurrentV1;
		if (method === 'findDigestPage' || method === 'findManagedDigestPage') {
			if (!isMediaContentSha256(args[0])) throw new TypeError('Native media digest lookup requires a lowercase SHA-256.');
			captured = { method, signal, sha256: args[0], afterAssetId: cursor(args[1]) };
		} else if (method === 'readPage') {
			const query = record(args[0], 'native Photo root page', ['catalogId', 'importId', 'afterKey'], ['catalogId']);
			const imported = Object.hasOwn(query, 'importId') ? field(query, 'importId', 'native Photo root page') : null;
			captured = { method, signal, catalogId: catalogOriginalId(field(query, 'catalogId', 'native Photo root page')),
				importId: imported === null || imported === undefined ? null : catalogOriginalId(imported),
				afterKey: cursor(Object.hasOwn(query, 'afterKey') ? field(query, 'afterKey', 'native Photo root page') : null) };
		} else {
			const catalogId = catalogOriginalId(args[0]), staged = method === 'stage' || method === 'releaseStaged' || method === 'promote';
			const importId = staged ? catalogOriginalId(args[1]) : null, input = args[staged ? 2 : 1];
			if (method === 'retain' || method === 'stage') {
				const references = Object.freeze(catalogOriginalReferences(input)); catalogOriginalPhotoIds(references.map(item => item.photoId));
				captured = { method, signal, catalogId, importId, references };
			} else if (method === 'release' || method === 'releaseStaged' || method === 'promote') {
				captured = { method, signal, catalogId, importId, photoIds: Object.freeze(catalogOriginalPhotoIds(input)) };
			} else throw new TypeError('Unsupported native Photo custody method.');
		}
		check(signal); const packet = Object.freeze(captured); admitted.add(packet); return packet;
	} catch (error) { check(signal); throw error; }
}

/** One synchronous snapshot or atomic publication; never a held SQLite
 * transaction across a filesystem operation, borrowed callback or await. */
export function executeLightscaperNativePhotoCustodyRequestCurrentV1(database: DatabaseSync,
	packet: LightscaperNativePhotoCustodyRequestCurrentV1, signalOverride?: AbortSignal): Result {
	if (!packet || typeof packet !== 'object' || !admitted.has(packet)) throw new TypeError('Native Photo custody requires its genuine captured packet.');
	const signal = signalOverride ?? packet.signal;
	if (database.isTransaction) throw new Error('Native Photo custody requires no active transaction.');
	check(signal); const reading = packet.method === 'readPage' || (packet.method === 'findDigestPage' || packet.method === 'findManagedDigestPage');
	database.exec(reading ? 'BEGIN' : 'BEGIN IMMEDIATE');
	try {
		let result: Result = undefined;
		if (packet.method === 'readPage') result = rootPage(database, packet, signal);
		else if (packet.method === 'findDigestPage' || packet.method === 'findManagedDigestPage') result = digestPage(database, packet, signal);
		else if (packet.method === 'retain' || packet.method === 'stage') {
			for (const reference of packet.references) { check(signal); putRoot(database, makeRoot(database, packet.catalogId, packet.importId, reference)); }
		} else if (packet.method === 'release' || packet.method === 'releaseStaged' || packet.method === 'promote') {
			for (const photoId of packet.photoIds) {
				check(signal); const key = catalogOriginalKey(packet.catalogId, packet.importId, photoId), previous = getRoot(database, key);
				if (packet.method === 'promote') {
					if (!previous) throw new Error('The provisional native catalog Original root is missing.');
					putRoot(database, makeRoot(database, packet.catalogId, null, previous));
				}
				if (previous) deleteRoot(database, previous);
			}
		}
		check(signal); database.exec('COMMIT');
		// A write has its durable ACK now. Only read publication retains a
		// post-snapshot cancellation boundary.
		if (reading) check(signal); return result;
	} catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Photo custody and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}

function makeRoot(database: DatabaseSync, catalogId: string, importId: string | null, reference: CatalogOriginalReferenceV1): Readonly<CatalogOriginalRootV1> {
	const media = asset(database, reference.assetId);
	if (media.sha256 !== reference.sha256 || media.size !== reference.size) throw new Error('Native catalog Original differs from its verified media asset.');
	return normalizeCatalogOriginalRoot({ ...reference, schemaVersion: 1, key: catalogOriginalKey(catalogId, importId, reference.photoId),
		catalogId, importId, scope: catalogOriginalScope(catalogId, importId), mediaContentToken: media.token });
}
function asset(database: DatabaseSync, key: string): Asset {
	const row = database.prepare(`${ASSET} WHERE a.source_id=?`).get(readKey(key));
	if (!row) throw new Error('Native catalog Original requires verified durable media.');
	return readAsset(row, key);
}
function readAsset(row: SqlRow, key: string): Asset {
	if (readKey(row.source_id) !== key || !isMediaContentSha256(row.sha256) || typeof row.size !== 'number' || !Number.isSafeInteger(row.size)
		|| row.size < 1 || row.size > MAXIMUM || !isMediaContentToken(row.media_content_token) || typeof row.root_count !== 'number'
		|| !Number.isSafeInteger(row.root_count) || row.root_count < 0 || (row.identity_kind !== 'managed' && row.identity_kind !== 'linked')) {
		throw new Error('Native catalog Original asset provenance or physical binding is corrupt.');
	}
	return Object.freeze({ key, sha256: row.sha256, size: row.size, token: row.media_content_token, count: row.root_count });
}
function getRoot(database: DatabaseSync, key: string): Readonly<CatalogOriginalRootV1> | null {
	const row = database.prepare(`SELECT ${ROOT_COLUMNS} FROM native_photo_media_roots WHERE root_key=?`).get(utf16(key));
	if (!row) return null;
	const root = readRoot(database, row); if (root.key !== key) throw new Error('Native catalog Original key differs from its request.'); return root;
}
function readRoot(database: DatabaseSync, row: SqlRow): Readonly<CatalogOriginalRootV1> {
	if (typeof row.root !== 'string' || Buffer.byteLength(row.root, 'utf8') > CATALOG_ORIGINAL_ROOT_MAX_BYTES) throw new TypeError('Native catalog Original root exceeds its byte bound.');
	const parsed: unknown = JSON.parse(row.root), root = normalizeCatalogOriginalRoot(parsed);
	if (JSON.stringify(root) !== row.root || !sameBytes(row.root_key, utf16(root.key)) || !sameBytes(row.scope_key, utf16(root.scope)) || row.asset_id !== root.assetId) {
		throw new Error('Native catalog Original scalar key or canonical document is corrupt.');
	}
	const media = asset(database, root.assetId);
	if (media.token !== root.mediaContentToken || media.sha256 !== root.sha256 || media.size !== root.size) throw new Error('Retained native catalog Original generation changed.');
	return root;
}
function putRoot(database: DatabaseSync, root: Readonly<CatalogOriginalRootV1>): void {
	const previous = getRoot(database, root.key);
	if (previous) {
		if (JSON.stringify(previous) !== JSON.stringify(root)) throw new Error('A native catalog Original root is immutable.'); return;
	}
	const inserted = database.prepare(`INSERT INTO native_photo_media_roots(${ROOT_COLUMNS}) VALUES(?,?,?,?)`).run(utf16(root.key), utf16(root.scope), root.assetId, JSON.stringify(root));
	if (inserted.changes !== 1) throw new Error('Native catalog Original root insertion was not published.');
	changeCount(database, root, 1);
	const stored = getRoot(database, root.key);
	if (!stored || JSON.stringify(stored) !== JSON.stringify(root)) throw new Error('Native catalog Original root changed before acknowledgment.');
}
function deleteRoot(database: DatabaseSync, root: Readonly<CatalogOriginalRootV1>): void {
	const removed = database.prepare('DELETE FROM native_photo_media_roots WHERE root_key=?').run(utf16(root.key));
	if (removed.changes !== 1 || database.prepare('SELECT 1 FROM native_photo_media_roots WHERE root_key=?').get(utf16(root.key))) {
		throw new Error('Native catalog Original root retirement was not published.');
	}
	changeCount(database, root, -1);
}
function changeCount(database: DatabaseSync, root: Readonly<CatalogOriginalRootV1>, delta: number): void {
	const current = asset(database, root.assetId);
	if (current.token !== root.mediaContentToken || current.sha256 !== root.sha256 || current.size !== root.size) throw new Error('Native retained media identity changed.');
	const next = Math.max(0, current.count + delta);
	if (!Number.isSafeInteger(next)) throw new RangeError('Native catalog Original count exceeds its safe integer bound.');
	const result = database.prepare('UPDATE native_photo_media_assets SET root_count=? WHERE source_id=? AND root_count=?').run(next, current.key, current.count);
	if (result.changes !== 1) throw new Error('Native catalog Original count publication changed.');
	const stored = asset(database, current.key);
	if (stored.count !== next || stored.token !== current.token || stored.sha256 !== current.sha256 || stored.size !== current.size) {
		throw new Error('Native catalog Original count or generation changed before acknowledgment.');
	}
}
function rootPage(database: DatabaseSync, packet: Extract<LightscaperNativePhotoCustodyRequestCurrentV1, { method: 'readPage' }>, signal?: AbortSignal): LightscaperNativePhotoCustodyRootPageCurrentV1 {
	const scope = catalogOriginalScope(packet.catalogId, packet.importId), parameters = packet.afterKey === null ? [utf16(scope)] : [utf16(scope), utf16(packet.afterKey)];
	const rows = database.prepare(`SELECT ${ROOT_COLUMNS} FROM native_photo_media_roots WHERE scope_key=?${packet.afterKey === null ? '' : ' AND root_key>?'} ORDER BY root_key LIMIT ${CATALOG_ORIGINAL_PAGE_SIZE}`).all(...parameters);
	const roots = rows.map(row => { check(signal); const root = readRoot(database, row); if (root.scope !== scope) throw new Error('Native catalog Original scope index is corrupt.'); return root; });
	return Object.freeze({ roots: Object.freeze(roots), afterKey: roots.length === CATALOG_ORIGINAL_PAGE_SIZE ? roots.at(-1)?.key ?? null : null });
}
function digestPage(database: DatabaseSync, packet: Extract<LightscaperNativePhotoCustodyRequestCurrentV1, { method: 'findDigestPage' | 'findManagedDigestPage' }>, signal?: AbortSignal): LightscaperNativePhotoCustodyDigestPageCurrentV1 {
	const parameters = packet.afterAssetId === null ? [packet.sha256] : [packet.sha256, packet.afterAssetId];
	const rows = database.prepare(`${ASSET} WHERE a.sha256=?${packet.method === 'findManagedDigestPage' ? " AND i.kind='managed'" : ''}${packet.afterAssetId === null ? '' : ' AND a.source_id>?'} ORDER BY a.source_id LIMIT ${CATALOG_ORIGINAL_PAGE_SIZE}`).all(...parameters);
	const matches = rows.map(row => { check(signal); const media = readAsset(row, readKey(row.source_id));
		if (media.sha256 !== packet.sha256) throw new Error('Native media digest index is corrupt.');
		return Object.freeze({ assetId: media.key, sha256: media.sha256, size: media.size }); });
	return Object.freeze({ matches: Object.freeze(matches), afterAssetId: rows.length === CATALOG_ORIGINAL_PAGE_SIZE ? matches.at(-1)?.assetId ?? null : null });
}
function utf16(value: string): Uint8Array {
	const bytes = new Uint8Array(value.length * 2);
	for (let index = 0; index < value.length; index += 1) { const unit = value.charCodeAt(index); bytes[index * 2] = unit >>> 8; bytes[index * 2 + 1] = unit & 255; }
	return bytes;
}
function sameBytes(value: unknown, expected: Uint8Array): boolean { return value instanceof Uint8Array && value.byteLength === expected.byteLength && value.every((byte, index) => byte === expected[index]); }
function cursor(value: unknown): string | null { if (value === null || value === undefined) return null; if (typeof value !== 'string') throw new TypeError('Native media continuation must be a string.'); return value; }
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
