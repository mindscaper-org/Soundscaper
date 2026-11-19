/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { readLightscaperNativeCatalogRowCurrentV1, readLightscaperNativeSummaryRowCurrentV1 } from './lightscaper-native-catalog-database-current-v1.ts';
import { filterScope, photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { PHOTO_CATALOG_REPOSITORY_LIMITS as LIMITS, PhotoCatalogRevisionConflictError,
	type PhotoCatalogContinuationV1, type PhotoCatalogFilterV1, type PhotoSummaryPageV1 } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { field, id, integer, record } from '../src/lightscaper/catalog/value-validation.ts';

type NativeRow = Record<string, SQLOutputValue>;
export interface LightscaperNativeCatalogSummaryPageRequestCurrentV1 {
	readonly filter?: PhotoCatalogFilterV1;
	readonly continuation?: PhotoCatalogContinuationV1 | null;
	readonly signal?: AbortSignal;
}
export interface LightscaperNativeCatalogSnapshotViewCurrentV1 {
	readonly catalog: PhotoCatalogRootV1;
	readonly indexRevision: number;
}
export interface AdmittedLightscaperNativeCatalogSnapshotCurrentV1 {
	readonly catalogId: string;
	readonly signal?: AbortSignal;
}
export interface AdmittedLightscaperNativeCatalogSummaryPageCurrentV1 {
	readonly catalogId: string;
	readonly scope: string;
	readonly collectionId: string | null;
	readonly continuation: PhotoCatalogContinuationV1 | null;
	readonly signal?: AbortSignal;
}
const admittedPages = new WeakSet<AdmittedLightscaperNativeCatalogSummaryPageCurrentV1>();
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const ROOT_COLUMNS = 'id,document,root_revision,photo_count,index_revision';
const SUMMARY_COLUMNS = 'photo_key,catalog_id,photo_id,revision,summary';

export function admitLightscaperNativeCatalogSnapshotCurrentV1(catalogId: unknown, options: unknown = {}): AdmittedLightscaperNativeCatalogSnapshotCurrentV1 {
	const catalog = id(catalogId, 'catalog ID'), input = record(options, 'native catalog snapshot request', ['signal'], []), signal = readSignal(input);
	return Object.freeze({ catalogId: catalog, ...(signal === undefined ? {} : { signal }) });
}

/** Capture before an owner waits on custody or another catalog task. These
 * inert main-private requests are not an IPC DTO or publication authority. */
export function admitLightscaperNativeCatalogSummaryPageCurrentV1(catalogId: unknown, options: unknown = {}): AdmittedLightscaperNativeCatalogSummaryPageCurrentV1 {
	const catalog = id(catalogId, 'catalog ID');
	const input = record(options, 'native catalog summary request', ['filter', 'continuation', 'signal'], []);
	const signal = readSignal(input);
	const filter = Object.hasOwn(input, 'filter') ? field(input, 'filter') : undefined;
	const scope = filterScope(catalog, filter as PhotoCatalogFilterV1 | undefined);
	const next = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : null;
	const continuation = next === null || next === undefined ? null : readContinuation(next, catalog, scope);
	const collectionPrefix = `${catalog}|collection|`;
	const result = Object.freeze({ catalogId: catalog, scope,
		collectionId: scope.startsWith(collectionPrefix) ? scope.slice(collectionPrefix.length) : null,
		continuation, ...(signal === undefined ? {} : { signal }) });
	admittedPages.add(result); return result;
}

/** Native snapshot is one atomic catalog row, with the same public snapshot
 * shape as Web Core. An absent row is null; torn scalar/root identity refuses. */
export function readLightscaperNativeCatalogSnapshotCurrentV1(database: DatabaseSync, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): LightscaperNativeCatalogSnapshotViewCurrentV1 | null {
	const { catalogId: catalog, signal } = admitLightscaperNativeCatalogSnapshotCurrentV1(catalogId, options);
	return readTransaction(database, signal, () => {
		const row = database.prepare(`SELECT ${ROOT_COLUMNS} FROM native_photo_catalogs WHERE id = ?`).get(catalog);
		if (row === undefined) return null;
		const { root, index } = readLightscaperNativeCatalogRowCurrentV1(row, catalog);
		return Object.freeze({ catalog: root, indexRevision: index.indexRevision });
	});
}

export function readLightscaperNativeCatalogSummaryPageCurrentV1(database: DatabaseSync, catalogId: string, options: unknown = {}): PhotoSummaryPageV1 {
	return readAdmittedLightscaperNativeCatalogSummaryPageCurrentV1(database, admitLightscaperNativeCatalogSummaryPageCurrentV1(catalogId, options));
}

/** Own one deferred readonly SQLite snapshot for both the revision fence and
 * at most64 scalar projections. No aggregate photo document is selected. */
export function readAdmittedLightscaperNativeCatalogSummaryPageCurrentV1(database: DatabaseSync,
	request: AdmittedLightscaperNativeCatalogSummaryPageCurrentV1): PhotoSummaryPageV1 {
	if (!admittedPages.has(request)) throw new TypeError('Native summary pages require their owning admitted request.');
	const { catalogId, scope, collectionId, continuation, signal } = request;
	return readTransaction(database, signal, () => {
		const row = database.prepare(`SELECT ${ROOT_COLUMNS} FROM native_photo_catalogs WHERE id = ?`).get(catalogId);
		if (row === undefined) throw new ReferenceError('Photo catalog is missing.');
		const { root, index } = readLightscaperNativeCatalogRowCurrentV1(row, catalogId);
		if (continuation && continuation.indexRevision !== index.indexRevision) throw new PhotoCatalogRevisionConflictError('catalog');
		if (collectionId !== null && root.collections.find(entry => entry.id === collectionId)?.kind === 'smart') {
			throw new RangeError('Smart collections require the live query pager.');
		}
		const all = scope === `${catalogId}|all`, after = continuation?.afterKey ?? '';
		const rows = all
			? database.prepare(`SELECT ${SUMMARY_COLUMNS} FROM native_photos
				WHERE catalog_id = ? AND photo_key > ? ORDER BY photo_key COLLATE BINARY ASC LIMIT ?`).all(catalogId, after, LIMITS.pageSize)
			: database.prepare(`SELECT m.key AS cursor_key,m.scope AS membership_scope,m.photo_key AS membership_photo_key,m.catalog_id AS membership_catalog_id,
				p.photo_key,p.catalog_id,p.photo_id,p.revision,p.summary
				FROM native_photo_memberships AS m LEFT JOIN native_photos AS p ON p.photo_key = m.photo_key
				WHERE m.catalog_id = ? AND m.scope = ? AND m.key > ? ORDER BY m.key COLLATE BINARY ASC LIMIT ?`).all(catalogId, scope, after, LIMITS.pageSize);
		const page = rows.map(value => {
			check(signal);
			const scalar = all ? value : summaryProjection(value);
			const summary = readLightscaperNativeSummaryRowCurrentV1(scalar, catalogId);
			const cursorKey = all ? summary.key : readMembershipKey(value, catalogId, scope, summary.photoId);
			return { summary, cursorKey };
		});
		const last = page.at(-1);
		return Object.freeze({ items: Object.freeze(page.map(entry => entry.summary)),
			continuation: last && page.length === LIMITS.pageSize ? Object.freeze({ catalogId, indexRevision: index.indexRevision,
				scope, afterKey: last.cursorKey }) : null });
	});
}

function summaryProjection(value: NativeRow): NativeRow {
	return { photo_key: value.photo_key!, catalog_id: value.catalog_id!, photo_id: value.photo_id!, revision: value.revision!, summary: value.summary! };
}
function readMembershipKey(value: NativeRow, catalog: string, scope: string, photoId: string): string {
	const expected = `${scope}|${photoId}`;
	if (value.cursor_key !== expected || value.membership_scope !== scope || value.membership_catalog_id !== catalog
		|| value.membership_photo_key !== photoStorageKey(catalog, photoId)) throw new TypeError('Native catalog membership disagrees with its summary or scope.');
	return expected;
}
function readContinuation(value: unknown, catalogId: string, scope: string): PhotoCatalogContinuationV1 {
	const input = record(value, 'catalog continuation', ['catalogId', 'indexRevision', 'scope', 'afterKey']);
	const prefix = scope === `${catalogId}|all` ? `${catalogId}|` : `${scope}|`, afterKey = field(input, 'afterKey');
	if (field(input, 'catalogId') !== catalogId || field(input, 'scope') !== scope || typeof afterKey !== 'string' || !afterKey.startsWith(prefix)) {
		throw new TypeError('Catalog continuation belongs to another catalog or query scope.');
	}
	id(afterKey.slice(prefix.length), 'continuation photo ID');
	return Object.freeze({ catalogId, scope, afterKey,
		indexRevision: integer(field(input, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'continuation index revision') });
}
function readSignal(input: Readonly<Record<string, unknown>>): AbortSignal | undefined {
	const value = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (value !== undefined) assertPhotoStackQuerySignalV1(value);
	return value as AbortSignal | undefined;
}
function check(signal: AbortSignal | undefined): void { if (signal) Reflect.apply(nativeThrowIfAborted, signal, []); }
function readTransaction<T>(database: DatabaseSync, signal: AbortSignal | undefined, run: () => T): T {
	check(signal);
	if (database.isTransaction) throw new Error('Native catalog read requires its own serialized transaction.');
	database.exec('BEGIN');
	try {
		const result = run(); check(signal); database.exec('COMMIT'); return result;
	} catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native catalog read and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
