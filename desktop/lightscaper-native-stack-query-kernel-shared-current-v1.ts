/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { assertLightscaperNativeStackSourceCurrentV1, LIGHTSCAPER_NATIVE_STACK_MEMBER_COLUMNS_CURRENT_V1,
	readLightscaperNativeStackInTransactionCurrentV1, type LightscaperNativeStackContextCurrentV1 } from './lightscaper-native-stack-auth-current-v1.ts';
import { readLightscaperNativeStackMemberRowCurrentV1 } from './lightscaper-native-stack-records-current-v1.ts';
import { getLightscaperNativeQueryBuildCurrentV1 } from './lightscaper-native-query-write-current-v1.ts';
import { getLightscaperNativeLegacyQueryBuildCurrentV1 } from './lightscaper-native-legacy-query-write-current-v1.ts';
import { pointLightscaperNativeQueryRowCurrentV1, seekLightscaperNativeQueryRowCurrentV1 } from './lightscaper-native-query-seek-current-v1.ts';
import { pointLightscaperNativeLegacyQueryRowCurrentV1, seekLightscaperNativeLegacyQueryRowCurrentV1 } from './lightscaper-native-legacy-query-seek-current-v1.ts';
import { photoQueryMatcherV1 } from '../src/lightscaper/catalog/photo-query-matcher-v1.ts';
import { photoQueryMatcherV2 } from '../src/lightscaper/catalog/photo-query-matcher-v2.ts';
import { PhotoQueryIndexNotReadyError } from '../src/lightscaper/catalog/photo-query-errors.ts';
import { photoQueryRowKeyV1, type PhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { photoQueryRowKeyV2, photoQuerySummaryV2, type PhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoQueryDigestV1, type PhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { photoQueryDigestV2, type PhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoQueryInclusivePosition } from '../src/lightscaper/catalog/photo-query-position.ts';
import { PHOTO_STACK_QUERY_LIMITS_V1 as LIMITS, type PhotoStackQueryContinuationV1 } from '../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import type { PhotoStackQueryContinuationV2 } from '../src/lightscaper/catalog/photo-stack-query-types-v2.ts';
import type { PhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { PhotoCatalogRevisionConflictError, type PhotoSummaryV1 } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { field, id, record } from '../src/lightscaper/catalog/value-validation.ts';

type Position = Pick<PhotoStackQueryContinuationV1, 'catalogId' | 'catalogRevision' | 'indexRevision' | 'stateRevision' | 'captureBucket' | 'afterKey' | 'pending' | 'stackAudit'>;
export type LightscaperNativeStackQueryProgressCurrentV1 = Omit<PhotoStackQueryContinuationV2, 'progressSha256'>;
export type LightscaperNativeLegacyStackQueryProgressCurrentV1 = Omit<PhotoStackQueryContinuationV1, 'progressSha256'>;
interface Result {
	readonly catalogName: string; readonly totalCount: number; readonly catalogRevision: number; readonly indexRevision: number;
	readonly stateRevision: number; readonly items: readonly PhotoSummaryV1[]; readonly scanned: number; readonly continuation: Position | null;
}
export type LightscaperNativeStackQueryResultCurrentV1 = Omit<Result, 'continuation'> & { readonly continuation: LightscaperNativeStackQueryProgressCurrentV1 | null };
export type LightscaperNativeLegacyStackQueryResultCurrentV1 = Omit<Result, 'continuation'> & { readonly continuation: LightscaperNativeLegacyStackQueryProgressCurrentV1 | null };
/** Private destination state is derived only after selected Current proof. No
 * public request admits this state, inclusive position, table, or matcher. */
export interface LightscaperNativeStackQueryDestinationCurrentV1 {
	readonly position: PhotoQueryInclusivePosition; inclusivePending: boolean; auditComplete: boolean; stateRevision: number | null;
}
interface Identity { readonly catalogId: string; readonly photoId: string; readonly captureBucket: 0 | 1 }
interface Profile<Row extends Identity, Query extends PhotoCatalogQueryV1> {
	readonly build: (database: DatabaseSync, catalogId: string) => Readonly<{ ready: boolean; indexedCount: number }> | null;
	readonly seek: (database: DatabaseSync, catalogId: string, query: Query, bucket: 0 | 1, after: readonly (string | number)[] | null, position?: PhotoQueryInclusivePosition) => Row | null;
	readonly point: (database: DatabaseSync, catalogId: string, photoId: string) => Row;
	readonly matcher: (root: PhotoCatalogRootV1, query: Query) => (row: Row) => boolean;
	readonly key: (row: Row, field: PhotoCatalogQueryV1['sort']['field']) => (string | number)[];
	readonly summary: (row: Row) => PhotoSummaryV1;
}
const legacy: Profile<PhotoQueryRowV1, PhotoCatalogQueryV1> = Object.freeze({ build: getLightscaperNativeLegacyQueryBuildCurrentV1,
	seek: seekLightscaperNativeLegacyQueryRowCurrentV1, point: pointLightscaperNativeLegacyQueryRowCurrentV1,
	matcher: photoQueryMatcherV1, key: photoQueryRowKeyV1, summary: (row: PhotoQueryRowV1) => row.summary });
const metadata: Profile<PhotoQueryRowV2, PhotoCatalogQueryV2> = Object.freeze({ build: getLightscaperNativeQueryBuildCurrentV1,
	seek: seekLightscaperNativeQueryRowCurrentV1, point: pointLightscaperNativeQueryRowCurrentV1,
	matcher: photoQueryMatcherV2, key: photoQueryRowKeyV2, summary: photoQuerySummaryV2 });
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

/** Fixed owning entrypoints choose private profiles; callers cannot supply a
 * table/reader/matcher. Both share only the same bounded representative state. */
export function readLightscaperNativeStackQueryInTransactionCurrentV1(database: DatabaseSync, context: Readonly<LightscaperNativeStackContextCurrentV1>,
	query: PhotoCatalogQueryV2, continuation: LightscaperNativeStackQueryProgressCurrentV1 | null, signal?: AbortSignal,
	destination?: LightscaperNativeStackQueryDestinationCurrentV1): Readonly<LightscaperNativeStackQueryResultCurrentV1> {
	const result = read(database, context, query, continuation, metadata, signal, destination);
	return Object.freeze({ ...result, continuation: result.continuation === null ? null : Object.freeze({ schemaVersion: 2 as const,
		kind: 'collapsed-photo-query' as const, ...result.continuation, querySha256: photoQueryDigestV2(query) }) });
}
export function readLightscaperNativeLegacyStackQueryInTransactionCurrentV1(database: DatabaseSync, context: Readonly<LightscaperNativeStackContextCurrentV1>,
	query: PhotoCatalogQueryV1, continuation: LightscaperNativeLegacyStackQueryProgressCurrentV1 | null, signal?: AbortSignal,
	destination?: LightscaperNativeStackQueryDestinationCurrentV1): Readonly<LightscaperNativeLegacyStackQueryResultCurrentV1> {
	const result = read(database, context, query, continuation, legacy, signal, destination);
	return Object.freeze({ ...result, continuation: result.continuation === null ? null : Object.freeze({ schemaVersion: 1 as const,
		kind: 'collapsed-photo-query' as const, ...result.continuation, querySha256: photoQueryDigestV1(query) }) });
}

function read<Row extends Identity, Query extends PhotoCatalogQueryV1>(database: DatabaseSync,
	context: Readonly<LightscaperNativeStackContextCurrentV1>, query: Query, continuation: Position | null,
	profile: Profile<Row, Query>, signal?: AbortSignal, destination?: LightscaperNativeStackQueryDestinationCurrentV1): Readonly<Result> {
	if (!database.isTransaction) throw new Error('Collapsed native query requires one caller snapshot.');
	check(signal); const { root, index, state } = context, catalogId = root.id;
	if (continuation && (continuation.catalogId !== catalogId || continuation.catalogRevision !== root.revision
		|| continuation.indexRevision !== index.indexRevision || continuation.stateRevision !== state.revision)) throw new PhotoCatalogRevisionConflictError('catalog');
	if (destination) {
		if (destination.stateRevision !== null && destination.stateRevision !== state.revision) throw new PhotoCatalogRevisionConflictError('catalog');
		destination.stateRevision = state.revision;
	}
	const build = profile.build(database, catalogId);
	if (!build?.ready) throw new PhotoQueryIndexNotReadyError();
	if (build.indexedCount !== root.photoCount) throw new TypeError('Ready collapsed native query count differs from its catalog.');
	const matches = profile.matcher(root, query), items: PhotoSummaryV1[] = [];
	let scanned = 0, captureBucket: 0 | 1 = continuation?.captureBucket ?? 0;
	let afterKey = continuation?.afterKey ?? null, pending = continuation?.pending ?? null, stackAudit = continuation?.stackAudit ?? null;
	if (state.stackCount === 0 && stackAudit !== null) throw new TypeError('Empty grouping state cannot retain an active stack audit.');
	if (state.stackCount > 0 && (!continuation || stackAudit) && !destination?.auditComplete) {
		let count = stackAudit?.count ?? 0, after = stackAudit?.afterKey ?? null;
		while (scanned < LIMITS.candidates) {
			check(signal);
			const raw = database.prepare(`SELECT stack_key,catalog_id,stack_id FROM native_photo_stacks
				WHERE catalog_id=? ${after === null ? '' : 'AND stack_key>?'} ORDER BY stack_key ASC LIMIT 1`)
				.get(...(after === null ? [catalogId] : [catalogId, after]));
			if (raw === undefined) {
				if (count !== state.stackCount) throw new TypeError('Collapsed query stack record count differs from its grouping state.');
				stackAudit = null; break;
			}
			const row = record(raw, 'audited native stack key', ['stack_key', 'catalog_id', 'stack_id']);
			const stackId = id(field(row, 'stack_id'), 'audited stack ID'), key = photoStorageKey(catalogId, stackId);
			if (field(row, 'catalog_id') !== catalogId || field(row, 'stack_key') !== key) throw new TypeError('Audited stack key has another catalog identity.');
			scanned++; count++; after = key;
			if (count > state.stackCount) throw new TypeError('Collapsed query stack record count exceeds its grouping state.');
			stackAudit = Object.freeze({ afterKey: key, count });
		}
	}
	if (destination && stackAudit === null) {
		destination.auditComplete = true;
		if (destination.inclusivePending) { captureBucket = destination.position.captureBucket; afterKey = destination.position.key; }
	}
	let exhausted = false;
	while (stackAudit === null && scanned < LIMITS.candidates) {
		check(signal);
		const row = pending ? pointRow(pending.photoId) : profile.seek(database, catalogId, query, captureBucket, destination?.inclusivePending ? null : afterKey, destination?.inclusivePending ? destination.position : undefined);
		if (destination) destination.inclusivePending = false;
		if (row === null) {
			if (query.sort.field === 'capture-time' && captureBucket === 0) { captureBucket = 1; afterKey = null; continue; }
			exhausted = true; break;
		}
		if (!pending) { scanned++; assertLightscaperNativeStackSourceCurrentV1(database, catalogId, row.photoId); }
		const key = profile.key(row, query.sort.field);
		if (pending && JSON.stringify(key) !== JSON.stringify(afterKey)) throw new TypeError('Pending collapsed query row moved from its captured position.');
		afterKey = Object.freeze(key);
		if (!matches(row)) { if (pending) throw new TypeError('Pending collapsed query row no longer matches its query.'); continue; }
		const stack = membership(row.photoId);
		if (stack === null) { if (pending) throw new TypeError('Pending collapsed query row lost its stack.'); items.push(profile.summary(row)); continue; }
		if (state.stackCount === 0) throw new TypeError('Collapsed query membership differs from its grouping state.');
		if (pending && (stack.id !== pending.stackId || stack.revision !== pending.stackRevision || pending.nextMember > stack.photoIds.length)) {
			throw new PhotoCatalogRevisionConflictError('catalog');
		}
		const isCover = stack.coverPhotoId === row.photoId;
		let position = pending?.nextMember ?? 0, show: boolean | null = null;
		if (!isCover && scanned < LIMITS.candidates) {
			const cover = pointRow(stack.coverPhotoId); membership(cover.photoId, stack);
			if (matches(cover)) show = false;
		}
		while (show === null && position < stack.photoIds.length && scanned < LIMITS.candidates) {
			const photoId = stack.photoIds[position++]!;
			if (photoId === row.photoId || !isCover && photoId === stack.coverPhotoId) continue;
			const member = pointRow(photoId); membership(photoId, stack);
			if (!isCover && matches(member) && precedes(member, row, query, profile.key)) show = false;
		}
		if (show === null && position === stack.photoIds.length) show = true;
		if (show === null) { pending = Object.freeze({ photoId: row.photoId, stackId: stack.id, stackRevision: stack.revision, nextMember: position }); break; }
		if (show) items.push(profile.summary(row));
		pending = null;
	}
	return Object.freeze({ catalogName: root.name, totalCount: root.photoCount, catalogRevision: root.revision, indexRevision: index.indexRevision,
		stateRevision: state.revision, items: Object.freeze(items), scanned, continuation: exhausted ? null : Object.freeze({ catalogId, catalogRevision: root.revision, indexRevision: index.indexRevision, stateRevision: state.revision,
			captureBucket, afterKey, pending, stackAudit }) });

	function pointRow(photoId: string): Row {
		check(signal); if (scanned >= LIMITS.candidates) throw new Error('Collapsed native query point read exceeds its shared ledger.');
		scanned++; const row = profile.point(database, catalogId, photoId);
		assertLightscaperNativeStackSourceCurrentV1(database, catalogId, photoId); return row;
	}
	function membership(photoId: string, expected?: Readonly<PhotoStackV1>): Readonly<PhotoStackV1> | null {
		check(signal); const key = photoStorageKey(catalogId, photoId);
		const forwardRaw = database.prepare(`SELECT ${LIGHTSCAPER_NATIVE_STACK_MEMBER_COLUMNS_CURRENT_V1} FROM native_photo_stack_forward_members WHERE photo_key=?`).get(key);
		const reverseRaw = database.prepare(`SELECT ${LIGHTSCAPER_NATIVE_STACK_MEMBER_COLUMNS_CURRENT_V1} FROM native_photo_stack_memberships WHERE photo_key=?`).get(key);
		if (forwardRaw === undefined && reverseRaw === undefined) {
			if (expected) throw new TypeError('Collapsed query expected member has no stack membership.'); return null;
		}
		if (forwardRaw === undefined || reverseRaw === undefined) throw new TypeError('Collapsed query forward and reverse membership disagree.');
		const forward = readLightscaperNativeStackMemberRowCurrentV1(forwardRaw, catalogId), reverse = readLightscaperNativeStackMemberRowCurrentV1(reverseRaw, catalogId);
		if (forward.photoKey !== key || forward.photoId !== photoId || JSON.stringify(forward) !== JSON.stringify(reverse)) throw new TypeError('Collapsed query forward and reverse membership disagree.');
		const stack = expected ?? readLightscaperNativeStackInTransactionCurrentV1(database, catalogId, forward.stackId);
		if (!stack || stack.id !== forward.stackId || stack.photoIds[forward.memberPosition] !== photoId) throw new TypeError('Collapsed query member position differs from its stored stack.');
		return stack;
	}
}
function precedes<Row extends Identity>(left: Row, right: Row, query: PhotoCatalogQueryV1,
	rowKey: (row: Row, field: PhotoCatalogQueryV1['sort']['field']) => (string | number)[]): boolean {
	const a = rowKey(left, query.sort.field), b = rowKey(right, query.sort.field);
	if (query.sort.field === 'capture-time' && a[1] !== b[1]) return left.captureBucket < right.captureBucket;
	for (let index = 0; index < a.length; index++) {
		if (a[index] === b[index]) continue;
		return query.sort.direction === 'ascending' ? a[index]! < b[index]! : a[index]! > b[index]!;
	}
	return false;
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
