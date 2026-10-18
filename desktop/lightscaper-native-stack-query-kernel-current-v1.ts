/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { assertLightscaperNativeStackSourceCurrentV1, LIGHTSCAPER_NATIVE_STACK_MEMBER_COLUMNS_CURRENT_V1,
	readLightscaperNativeStackInTransactionCurrentV1, type LightscaperNativeStackContextCurrentV1 } from './lightscaper-native-stack-auth-current-v1.ts';
import { readLightscaperNativeStackMemberRowCurrentV1 } from './lightscaper-native-stack-records-current-v1.ts';
import { getLightscaperNativeQueryBuildCurrentV1 } from './lightscaper-native-query-write-current-v1.ts';
import { pointLightscaperNativeQueryRowCurrentV1, seekLightscaperNativeQueryRowCurrentV1 } from './lightscaper-native-query-seek-current-v1.ts';
import { photoQueryMatcherV2 } from '../src/lightscaper/catalog/photo-query-matcher-v2.ts';
import { PhotoQueryIndexNotReadyError } from '../src/lightscaper/catalog/photo-query-errors.ts';
import { photoQueryRowKeyV2, photoQuerySummaryV2, type PhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoQueryDigestV2, type PhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { PHOTO_STACK_QUERY_LIMITS_V2 as LIMITS, type PhotoStackQueryContinuationV2, type PhotoStackQueryPageV2 } from '../src/lightscaper/catalog/photo-stack-query-types-v2.ts';
import type { PhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { PhotoCatalogRevisionConflictError, type PhotoSummaryV1 } from '../src/lightscaper/catalog/repository-types.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { field, id, record } from '../src/lightscaper/catalog/value-validation.ts';

/** Private unsigned state never escapes the owning synchronous adapter. */
export type LightscaperNativeStackQueryProgressCurrentV1 = Omit<PhotoStackQueryContinuationV2, 'progressSha256'>;
export type LightscaperNativeStackQueryResultCurrentV1 = Omit<PhotoStackQueryPageV2, 'schemaVersion' | 'kind' | 'catalogId' | 'continuation'> & {
	readonly continuation: LightscaperNativeStackQueryProgressCurrentV1 | null;
};
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

/** One fresh native snapshot, fixed shared matcher and one64-read ledger.
 * Initial key audit, global candidates and every point probe all consume it.
 * Only the representative/current probe and one bounded stack document are
 * retained; no catalog, query-row or member-result inventory is accumulated.
 * The owning adapter alone authenticates incoming and signs outgoing progress. */
export function readLightscaperNativeStackQueryInTransactionCurrentV1(database: DatabaseSync,
	context: Readonly<LightscaperNativeStackContextCurrentV1>, query: PhotoCatalogQueryV2,
	continuation: LightscaperNativeStackQueryProgressCurrentV1 | null, signal?: AbortSignal): Readonly<LightscaperNativeStackQueryResultCurrentV1> {
	if (!database.isTransaction) throw new Error('Collapsed native Query2 requires one caller snapshot.');
	check(signal); const { root, index, state } = context, catalogId = root.id;
	if (continuation && (continuation.catalogId !== catalogId || continuation.catalogRevision !== root.revision
		|| continuation.indexRevision !== index.indexRevision || continuation.stateRevision !== state.revision)) throw new PhotoCatalogRevisionConflictError('catalog');
	const build = getLightscaperNativeQueryBuildCurrentV1(database, catalogId);
	if (!build?.ready) throw new PhotoQueryIndexNotReadyError();
	if (build.indexedCount !== root.photoCount) throw new TypeError('Ready collapsed native query count differs from its catalog.');
	const matches = photoQueryMatcherV2(root, query), items: PhotoSummaryV1[] = [];
	let scanned = 0, captureBucket: 0 | 1 = continuation?.captureBucket ?? 0;
	let afterKey = continuation?.afterKey ?? null, pending = continuation?.pending ?? null, stackAudit = continuation?.stackAudit ?? null;
	if (state.stackCount === 0 && stackAudit !== null) throw new TypeError('Empty grouping state cannot retain an active stack audit.');
	if (state.stackCount > 0 && (!continuation || stackAudit)) {
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
	let exhausted = false;
	while (stackAudit === null && scanned < LIMITS.candidates) {
		check(signal);
		const row = pending ? pointRow(pending.photoId) : seekLightscaperNativeQueryRowCurrentV1(database, catalogId, query, captureBucket, afterKey);
		if (row === null) {
			if (query.sort.field === 'capture-time' && captureBucket === 0) { captureBucket = 1; afterKey = null; continue; }
			exhausted = true; break;
		}
		if (!pending) { scanned++; assertLightscaperNativeStackSourceCurrentV1(database, catalogId, row.photoId); }
		const key = photoQueryRowKeyV2(row, query.sort.field);
		if (pending && JSON.stringify(key) !== JSON.stringify(afterKey)) throw new TypeError('Pending collapsed query row moved from its captured position.');
		afterKey = Object.freeze(key);
		if (!matches(row)) { if (pending) throw new TypeError('Pending collapsed query row no longer matches its query.'); continue; }
		const stack = membership(row.photoId);
		if (stack === null) { if (pending) throw new TypeError('Pending collapsed query row lost its stack.'); items.push(photoQuerySummaryV2(row)); continue; }
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
			if (!isCover && matches(member) && precedes(member, row, query)) show = false;
		}
		if (show === null && position === stack.photoIds.length) show = true;
		if (show === null) { pending = Object.freeze({ photoId: row.photoId, stackId: stack.id, stackRevision: stack.revision, nextMember: position }); break; }
		if (show) items.push(photoQuerySummaryV2(row));
		pending = null;
	}
	return Object.freeze({ catalogName: root.name, totalCount: root.photoCount, catalogRevision: root.revision, indexRevision: index.indexRevision,
		stateRevision: state.revision, items: Object.freeze(items), scanned, continuation: exhausted ? null : Object.freeze({ schemaVersion: 2,
			kind: 'collapsed-photo-query', catalogId, catalogRevision: root.revision, indexRevision: index.indexRevision, stateRevision: state.revision,
			querySha256: photoQueryDigestV2(query), captureBucket, afterKey, pending, stackAudit }) });

	function pointRow(photoId: string): PhotoQueryRowV2 {
		check(signal); if (scanned >= LIMITS.candidates) throw new Error('Collapsed native query point read exceeds its shared ledger.');
		scanned++; const row = pointLightscaperNativeQueryRowCurrentV1(database, catalogId, photoId);
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
function precedes(left: PhotoQueryRowV2, right: PhotoQueryRowV2, query: PhotoCatalogQueryV2): boolean {
	const a = photoQueryRowKeyV2(left, query.sort.field), b = photoQueryRowKeyV2(right, query.sort.field);
	if (query.sort.field === 'capture-time' && a[1] !== b[1]) return left.captureBucket < right.captureBucket;
	for (let index = 0; index < a.length; index++) {
		if (a[index] === b[index]) continue;
		return query.sort.direction === 'ascending' ? a[index]! < b[index]! : a[index]! > b[index]!;
	}
	return false;
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
