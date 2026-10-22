/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite';
import { readLightscaperNativeStackRowCurrentV1, readLightscaperNativeStackMemberRowCurrentV1 } from './lightscaper-native-stack-records-current-v1.ts';
import { readLightscaperNativeSummaryRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { authenticateLightscaperNativeStackCurrentV1, captureLightscaperNativeStackContextCurrentV1,
	readLightscaperNativeStackInTransactionCurrentV1 } from './lightscaper-native-stack-auth-current-v1.ts';
import { PHOTO_STACK_LIMITS_V1 as LIMITS } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { admitPhotoStackMemberIdsV1, readPhotoStackPageOptionsV1, readPhotoStackSignalOptionsV1, PhotoStackRevisionConflictError,
	type PhotoStackContinuationV1, type PhotoStackMembershipPageOptionsV1, type PhotoStackMembershipV1,
	type PhotoStackMemberSummaryV1, type PhotoStackPageV1, type PhotoStackSummaryV1 } from '../src/lightscaper/catalog/photo-stack-repository-contract-v1.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { id, integer } from '../src/lightscaper/catalog/value-validation.ts';

type Scope = 'stacks' | 'memberships';
type Context = ReturnType<typeof captureLightscaperNativeStackContextCurrentV1>;
type NativeRow = Record<string, SQLOutputValue>;
type Member = ReturnType<typeof readLightscaperNativeStackMemberRowCurrentV1>;
export interface AdmittedLightscaperNativeStackPageCurrentV1 {
	readonly catalogId: string; readonly scope: Scope; readonly options: Readonly<PhotoStackMembershipPageOptionsV1>;
}
export interface AdmittedLightscaperNativeStackMemberPageCurrentV1 {
	readonly catalogId: string; readonly stackId: string; readonly expectedRevision: number;
	readonly photoIds: readonly string[]; readonly signal?: AbortSignal;
}
const admittedPages = new WeakSet<AdmittedLightscaperNativeStackPageCurrentV1>();
const admittedMembers = new WeakSet<AdmittedLightscaperNativeStackMemberPageCurrentV1>();
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const STACK_COLUMNS = 'stack_key,catalog_id,stack_id,revision,document,photo_count,cover_photo_id';
const MEMBER_COLUMNS = 'photo_key,catalog_id,photo_id,stack_key,stack_id,member_position';
const SUMMARY_COLUMNS = 'photo_key,catalog_id,photo_id,revision,summary';

/** Main-private packets: register the owner task before borrowed validation,
 * capture synchronously, and preserve the genuine object through queue waits. */
export function admitLightscaperNativeStackPageCurrentV1(catalogId: unknown, options: unknown = {}, scope: Scope = 'stacks'): AdmittedLightscaperNativeStackPageCurrentV1 {
	if (scope !== 'stacks' && scope !== 'memberships') throw new TypeError('Unsupported native stack page scope.');
	const catalog = id(catalogId, 'stack catalog ID'), captured = readPhotoStackPageOptionsV1(options, catalog, scope);
	const result = Object.freeze({ catalogId: catalog, scope, options: captured }); admittedPages.add(result); return result;
}
export function admitLightscaperNativeStackMemberPageCurrentV1(catalogId: unknown, stackId: unknown, expectedRevision: unknown,
	photoIds: unknown, options: unknown = {}): AdmittedLightscaperNativeStackMemberPageCurrentV1 {
	const result = Object.freeze({ catalogId: id(catalogId, 'stack catalog ID'), stackId: id(stackId, 'stack ID'),
		expectedRevision: integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'stack expected revision'),
		photoIds: admitPhotoStackMemberIdsV1(photoIds), ...readPhotoStackSignalOptionsV1(options) });
	admittedMembers.add(result); return result;
}

export function readLightscaperNativeStackPageCurrentV1(database: DatabaseSync, catalogId: string, options: unknown = {}): PhotoStackPageV1<PhotoStackSummaryV1> {
	return readAdmittedLightscaperNativeStackPageCurrentV1(database, admitLightscaperNativeStackPageCurrentV1(catalogId, options));
}
export function readLightscaperNativeStackMembershipPageCurrentV1(database: DatabaseSync, catalogId: string, options: unknown = {}): PhotoStackPageV1<PhotoStackMembershipV1> {
	return readAdmittedLightscaperNativeStackMembershipPageCurrentV1(database, admitLightscaperNativeStackPageCurrentV1(catalogId, options, 'memberships'));
}
export function readLightscaperNativeStackMemberPageCurrentV1(database: DatabaseSync, catalogId: string, stackId: string,
	expectedRevision: number, photoIds: readonly string[], options: unknown = {}): readonly PhotoStackMemberSummaryV1[] {
	return readAdmittedLightscaperNativeStackMemberPageCurrentV1(database, admitLightscaperNativeStackMemberPageCurrentV1(catalogId, stackId, expectedRevision, photoIds, options));
}

export function readAdmittedLightscaperNativeStackPageCurrentV1(database: DatabaseSync,
	request: AdmittedLightscaperNativeStackPageCurrentV1): PhotoStackPageV1<PhotoStackSummaryV1> {
	assertPage(request, 'stacks'); const { catalogId, options } = request;
	return readTransaction(database, options.signal, () => {
		const captured = captureLightscaperNativeStackContextCurrentV1(database, catalogId); checkContinuation(options.continuation, captured);
		// Validate and discard one bounded document per step; retained items are
		// scalar summaries. Full reverse authentication is the explicit loader's job.
		const items = cursorPage(database, `SELECT ${STACK_COLUMNS} FROM native_photo_stacks
			WHERE catalog_id=? AND stack_key>? ORDER BY stack_key LIMIT ?`, [catalogId, options.continuation?.afterKey ?? '', LIMITS.pageSize], raw => {
			const stack = readLightscaperNativeStackRowCurrentV1(raw, catalogId);
			return Object.freeze({ catalogId, id: stack.id, revision: stack.revision, photoCount: stack.photoIds.length, coverPhotoId: stack.coverPhotoId });
		}, options.signal);
		if (items.length > captured.state.stackCount) throw new TypeError('Stack state count disagrees with its page.');
		return page(items, captured, 'stacks', items.at(-1)?.id);
	});
}

export function readAdmittedLightscaperNativeStackMembershipPageCurrentV1(database: DatabaseSync,
	request: AdmittedLightscaperNativeStackPageCurrentV1): PhotoStackPageV1<PhotoStackMembershipV1> {
	assertPage(request, 'memberships'); const { catalogId, options } = request;
	return readTransaction(database, options.signal, () => {
		const captured = captureLightscaperNativeStackContextCurrentV1(database, catalogId); checkContinuation(options.continuation, captured);
		const rows: Member[] = [];
		if (options.photoIds !== undefined) {
			for (const photoId of options.photoIds) { check(options.signal); const row = pointMembership(database, catalogId, photoId); if (row) rows.push(row); }
		} else rows.push(...cursorPage(database, `SELECT ${MEMBER_COLUMNS} FROM native_photo_stack_memberships
			WHERE catalog_id=? AND photo_key>? ORDER BY photo_key LIMIT ?`, [catalogId, options.continuation?.afterKey ?? '', LIMITS.pageSize], raw => {
			const row = readLightscaperNativeStackMemberRowCurrentV1(raw); assertMember(row, catalogId, row.photoId); return row;
		}, options.signal));
		const items: PhotoStackMembershipV1[] = [];
		for (const row of rows) {
			check(options.signal); authenticateMember(database, row);
			items.push(Object.freeze({ catalogId, photoId: row.photoId, stackId: row.stackId }));
		}
		if (rows.length && captured.state.stackCount === 0) throw new TypeError('Stack state disagrees with reverse membership.');
		return options.photoIds !== undefined ? Object.freeze({ items: Object.freeze(items), continuation: null })
			: page(items, captured, 'memberships', rows.at(-1)?.photoId);
	});
}

export function readAdmittedLightscaperNativeStackMemberPageCurrentV1(database: DatabaseSync,
	request: AdmittedLightscaperNativeStackMemberPageCurrentV1): readonly PhotoStackMemberSummaryV1[] {
	if (!admittedMembers.has(request)) throw new TypeError('Native stack member pages require their owning admitted request.');
	const { catalogId, stackId, expectedRevision, photoIds, signal } = request;
	return readTransaction(database, signal, () => {
		captureLightscaperNativeStackContextCurrentV1(database, catalogId);
		const stack = readLightscaperNativeStackInTransactionCurrentV1(database, catalogId, stackId);
		if (!stack || stack.revision !== expectedRevision) throw new PhotoStackRevisionConflictError();
		authenticateLightscaperNativeStackCurrentV1(database, stack, signal);
		if (photoIds.some(photoId => !stack.photoIds.includes(photoId))) throw new ReferenceError('Requested photo does not belong to the authenticated stack membership.');
		const statement = database.prepare(`SELECT ${SUMMARY_COLUMNS} FROM native_photos WHERE photo_key=?`);
		return Object.freeze(photoIds.map(photoId => {
			check(signal); const summary = readLightscaperNativeSummaryRowCurrentV1(statement.get(photoStorageKey(catalogId, photoId)), catalogId);
			if (summary.photoId !== photoId) throw new TypeError('Stack member summary disagrees with its requested identity.');
			return Object.freeze({ photoId, fileName: summary.fileName, photoRevision: summary.photoRevision });
		}));
	});
}

function pointMembership(database: DatabaseSync, catalogId: string, photoId: string): Member | null {
	const key = photoStorageKey(catalogId, photoId);
	const reverse = database.prepare(`SELECT ${MEMBER_COLUMNS} FROM native_photo_stack_memberships WHERE photo_key=?`).get(key);
	const forward = database.prepare(`SELECT ${MEMBER_COLUMNS} FROM native_photo_stack_forward_members WHERE photo_key=?`).get(key);
	if (reverse === undefined) { if (forward !== undefined) throw new TypeError('Forward stack membership has no reverse row.'); return null; }
	const row = readLightscaperNativeStackMemberRowCurrentV1(reverse); assertMember(row, catalogId, photoId);
	if (forward === undefined || !sameMember(row, readLightscaperNativeStackMemberRowCurrentV1(forward))) throw new TypeError('Reverse stack membership differs from its forward index.');
	return row;
}
function authenticateMember(database: DatabaseSync, row: Member): void {
	const forward = database.prepare(`SELECT ${MEMBER_COLUMNS} FROM native_photo_stack_forward_members WHERE photo_key=?`).get(row.photoKey);
	if (forward === undefined || !sameMember(row, readLightscaperNativeStackMemberRowCurrentV1(forward))) throw new TypeError('Reverse stack membership differs from its forward index.');
	const stack = readLightscaperNativeStackInTransactionCurrentV1(database, row.catalogId, row.stackId);
	if (!stack || stack.photoIds[row.memberPosition] !== row.photoId) throw new TypeError('Reverse membership disagrees with its ordered stack document.');
	const source = database.prepare('SELECT photo_key,catalog_id,photo_id FROM native_photos WHERE photo_key=?').get(row.photoKey);
	if (source === undefined) throw new ReferenceError('Stack member photo is missing.');
	if (source.photo_key !== row.photoKey || source.catalog_id !== row.catalogId || source.photo_id !== row.photoId) throw new TypeError('Stack member photo identity disagrees with its selected key.');
}
function assertMember(row: Member, catalogId: string, photoId: string): void {
	if (row.catalogId !== catalogId || row.photoId !== photoId || row.photoKey !== photoStorageKey(catalogId, photoId)) throw new TypeError('Stack membership leaves its requested identity.');
}
function sameMember(left: Member, right: Member): boolean {
	return left.photoKey === right.photoKey && left.catalogId === right.catalogId && left.photoId === right.photoId
		&& left.stackKey === right.stackKey && left.stackId === right.stackId && left.memberPosition === right.memberPosition;
}
function assertPage(request: AdmittedLightscaperNativeStackPageCurrentV1, scope: Scope): void {
	if (!admittedPages.has(request) || request.scope !== scope) throw new TypeError('Native stack pages require their owning admitted scope.');
}
function checkContinuation(value: PhotoStackContinuationV1 | null | undefined, captured: Context): void {
	if (value && (value.catalogRevision !== captured.root.revision || value.indexRevision !== captured.index.indexRevision
		|| value.stateRevision !== captured.state.revision)) throw new PhotoStackRevisionConflictError();
}
function page<T>(items: readonly T[], captured: Context, scope: Scope, lastId?: string): PhotoStackPageV1<T> {
	return Object.freeze({ items: Object.freeze(items), continuation: lastId && items.length === LIMITS.pageSize ? Object.freeze({
		catalogId: captured.root.id, scope, catalogRevision: captured.root.revision, indexRevision: captured.index.indexRevision,
		stateRevision: captured.state.revision, afterKey: photoStorageKey(captured.root.id, lastId) }) : null });
}

/** Retain only scalar projections; explicitly retire the native iterator on
 * exact64 or primary failure before the encompassing snapshot can commit. */
function cursorPage<T>(database: DatabaseSync, sql: string, parameters: SQLInputValue[], project: (row: NativeRow) => T, signal?: AbortSignal): T[] {
	const iterator = database.prepare(sql).iterate(...parameters), items: T[] = []; let exhausted = false, failed = false, primary: unknown;
	try {
		while (items.length < LIMITS.pageSize) {
			check(signal); const step = iterator.next(); if (step.done === true) { exhausted = true; break; }
			items.push(project(step.value));
		}
	} catch (error) { failed = true; primary = error; }
	if (!exhausted) {
		try { const ended = iterator.return?.(); if (!ended || ended.done !== true) throw new Error('Native stack cursor retirement is unproved.'); }
		catch (cleanup) { throw new AggregateError(failed ? [primary, cleanup] : [cleanup], 'Native stack cursor retirement failed.', { cause: cleanup }); }
	}
	if (failed) throw primary; return items;
}
function check(signal: AbortSignal | undefined): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
function readTransaction<T>(database: DatabaseSync, signal: AbortSignal | undefined, run: () => T): T {
	check(signal); if (database.isTransaction) throw new Error('Native stack page requires its own serialized transaction.');
	database.exec('BEGIN');
	try { const result = run(); check(signal); database.exec('COMMIT'); return result; }
	catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native stack page and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
