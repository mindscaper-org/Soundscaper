/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readValidatedPhotoCatalogRootV1, serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { normalizePhotoStackV1, normalizePhotoStackStateV1, serializePhotoStackV1, type PhotoStackStateV1, type PhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { admitPhotoStackSaveV1, readPhotoStackSignalOptionsV1, readPhotoStackWriteOptionsV1,
	PhotoStackRevisionConflictError, type PhotoStackWriteOptionsV1 } from '../src/lightscaper/catalog/photo-stack-repository-contract-v1.ts';
import { indexState, photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import { id, integer } from '../src/lightscaper/catalog/value-validation.ts';
import { readLightscaperNativeStackMemberRowCurrentV1 } from './lightscaper-native-stack-records-current-v1.ts';
import { authenticateLightscaperNativeStackCurrentV1, assertLightscaperNativeStackSourceCurrentV1, assertLightscaperNativeEmptyStackStateCurrentV1,
	captureLightscaperNativeStackContextCurrentV1, readLightscaperNativeStackInTransactionCurrentV1,
	LIGHTSCAPER_NATIVE_STACK_MEMBER_COLUMNS_CURRENT_V1 as MEMBER_COLUMNS, type LightscaperNativeStackContextCurrentV1 } from './lightscaper-native-stack-auth-current-v1.ts';
import { withProjectLibraryImmediateTransaction } from './project-library-immediate-transaction.ts';

const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

export function loadLightscaperNativeStackCurrentV1(database: DatabaseSync, catalogId: unknown, stackId: unknown,
	options: Readonly<{ signal?: AbortSignal }> = {}): Readonly<PhotoStackV1> | null {
	const catalog = id(catalogId, 'stack catalog ID'), selected = id(stackId, 'stack ID'), admitted = readPhotoStackSignalOptionsV1(options);
	return readTransaction(database, admitted.signal, () => {
		captureLightscaperNativeStackContextCurrentV1(database, catalog);
		const stack = readLightscaperNativeStackInTransactionCurrentV1(database, catalog, selected);
		if (stack) authenticateLightscaperNativeStackCurrentV1(database, stack, admitted.signal);
		return stack;
	});
}
export function readLightscaperNativeStackStateCurrentV1(database: DatabaseSync, catalogId: unknown,
	options: Readonly<{ signal?: AbortSignal }> = {}): Readonly<PhotoStackStateV1> {
	const catalog = id(catalogId, 'stack catalog ID'), admitted = readPhotoStackSignalOptionsV1(options);
	return readTransaction(database, admitted.signal, () => captureLightscaperNativeStackContextCurrentV1(database, catalog).state);
}

/** Every raw field is captured before SQL. The owner queues this synchronous
 * operation and preserves its committed return value after later cancellation. */
export function saveLightscaperNativeStackCurrentV1(database: DatabaseSync, value: unknown, expectedRevision: number | null,
	options: PhotoStackWriteOptionsV1): Readonly<PhotoStackV1> {
	const candidate = admitPhotoStackSaveV1(value, expectedRevision), admitted = readPhotoStackWriteOptionsV1(options);
	check(admitted.signal);
	return withProjectLibraryImmediateTransaction(database, () => {
		check(admitted.signal);
		const context = captureLightscaperNativeStackContextCurrentV1(database, candidate.catalogId); checkExpected(context, admitted);
		const previous = readLightscaperNativeStackInTransactionCurrentV1(database, candidate.catalogId, candidate.id);
		if (expectedRevision === null ? previous !== null : previous?.revision !== expectedRevision) throw new PhotoStackRevisionConflictError();
		if (previous) authenticateLightscaperNativeStackCurrentV1(database, previous, admitted.signal);
		for (const photoId of candidate.photoIds) {
			check(admitted.signal); assertLightscaperNativeStackSourceCurrentV1(database, candidate.catalogId, photoId);
			assertAvailable(database, candidate, previous, photoId);
		}
		const next = normalizePhotoStackV1({ ...candidate, revision: previous ? increment(previous.revision) : 0 });
		const state = nextState(context, previous ? 0 : 1), key = photoStorageKey(next.catalogId, next.id);
		// Reverse custody is independently published. SQLite's exact parent
		// UPDATE trigger deletes/recreates all forward facts, including positions.
		if (previous) {
			database.prepare('DELETE FROM native_photo_stack_memberships WHERE stack_key=?').run(key);
			const changed = database.prepare('UPDATE native_photo_stacks SET revision=?,document=?,photo_count=?,cover_photo_id=? WHERE stack_key=? AND revision=?')
				.run(next.revision, serializePhotoStackV1(next), next.photoIds.length, next.coverPhotoId, key, previous.revision);
			if (changed.changes !== 1) throw new PhotoStackRevisionConflictError();
		} else database.prepare('INSERT INTO native_photo_stacks(stack_key,catalog_id,stack_id,revision,document,photo_count,cover_photo_id) VALUES(?,?,?,?,?,?,?)')
			.run(key, next.catalogId, next.id, next.revision, serializePhotoStackV1(next), next.photoIds.length, next.coverPhotoId);
		for (let position = 0; position < next.photoIds.length; position++) {
			check(admitted.signal); const photoId = next.photoIds[position]!;
			database.prepare('INSERT INTO native_photo_stack_memberships(photo_key,catalog_id,photo_id,stack_key,stack_id,member_position) VALUES(?,?,?,?,?,?)')
				.run(photoStorageKey(next.catalogId, photoId), next.catalogId, photoId, key, next.id, position);
		}
		authenticateLightscaperNativeStackCurrentV1(database, next, admitted.signal);
		publishEpochs(database, context, state); check(admitted.signal); return next;
	});
}

export function dissolveLightscaperNativeStackCurrentV1(database: DatabaseSync, catalogId: unknown, stackId: unknown,
	expectedRevision: number, options: PhotoStackWriteOptionsV1): Readonly<PhotoStackStateV1> {
	const catalog = id(catalogId, 'stack catalog ID'), selected = id(stackId, 'stack ID');
	const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'stack expected revision'), admitted = readPhotoStackWriteOptionsV1(options);
	check(admitted.signal);
	return withProjectLibraryImmediateTransaction(database, () => {
		check(admitted.signal); const context = captureLightscaperNativeStackContextCurrentV1(database, catalog); checkExpected(context, admitted);
		const previous = readLightscaperNativeStackInTransactionCurrentV1(database, catalog, selected);
		if (!previous || previous.revision !== expected) throw new PhotoStackRevisionConflictError();
		authenticateLightscaperNativeStackCurrentV1(database, previous, admitted.signal);
		const state = nextState(context, -1), key = photoStorageKey(catalog, selected);
		database.prepare('DELETE FROM native_photo_stack_memberships WHERE stack_key=?').run(key);
		const removed = database.prepare('DELETE FROM native_photo_stacks WHERE stack_key=? AND revision=?').run(key, expected);
		if (removed.changes !== 1) throw new PhotoStackRevisionConflictError();
		// Native FK cascade retires the engine-owned forward relation.
		publishEpochs(database, context, state); check(admitted.signal); return state;
	});
}

function assertAvailable(database: DatabaseSync, candidate: PhotoStackV1, previous: Readonly<PhotoStackV1> | null, photoId: string): void {
	const key = photoStorageKey(candidate.catalogId, photoId);
	const rawForward = database.prepare(`SELECT ${MEMBER_COLUMNS} FROM native_photo_stack_forward_members WHERE photo_key=?`).get(key);
	const rawReverse = database.prepare(`SELECT ${MEMBER_COLUMNS} FROM native_photo_stack_memberships WHERE photo_key=?`).get(key);
	if (rawForward === undefined && rawReverse === undefined) return;
	if (rawForward === undefined || rawReverse === undefined) throw new TypeError('Forward and reverse stack ownership disagree.');
	const forward = readLightscaperNativeStackMemberRowCurrentV1(rawForward, candidate.catalogId), reverse = readLightscaperNativeStackMemberRowCurrentV1(rawReverse, candidate.catalogId);
	if (forward.photoKey !== key || JSON.stringify(forward) !== JSON.stringify(reverse)) throw new TypeError('Forward and reverse stack ownership disagree.');
	if (forward.stackId !== candidate.id) throw new RangeError('Photo already belongs to another stack.');
	if (previous?.photoIds[forward.memberPosition] !== photoId) throw new TypeError('Retained stack ownership disagrees with the previous document.');
}
function checkExpected(context: LightscaperNativeStackContextCurrentV1, options: PhotoStackWriteOptionsV1): void {
	if (context.root.revision !== options.expectedCatalogRevision) throw new PhotoCatalogRevisionConflictError('catalog');
	if (context.state.revision !== options.expectedStateRevision) throw new PhotoStackRevisionConflictError();
}
function nextState(context: LightscaperNativeStackContextCurrentV1, delta: number): Readonly<PhotoStackStateV1> {
	const state = normalizePhotoStackStateV1({ ...context.state, revision: increment(context.state.revision), stackCount: context.state.stackCount + delta });
	if (state.stackCount > Math.floor(context.root.photoCount / 2)) throw new TypeError('Stack count exceeds its catalog source capacity.');
	return state;
}
function publishEpochs(database: DatabaseSync, previous: LightscaperNativeStackContextCurrentV1, state: Readonly<PhotoStackStateV1>): void {
	const root = readValidatedPhotoCatalogRootV1({ ...previous.root, revision: increment(previous.root.revision) });
	const index = indexState(root, increment(previous.index.indexRevision));
	const rootChange = database.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=?,index_revision=? WHERE id=? AND root_revision=? AND index_revision=? AND photo_count=?')
		.run(serializeLightscaperDocumentV1(root), root.revision, index.indexRevision, root.id, previous.root.revision, previous.index.indexRevision, previous.root.photoCount);
	if (rootChange.changes !== 1) throw new PhotoCatalogRevisionConflictError('catalog');
	const stateChange = database.prepare('UPDATE native_photo_stack_states SET revision=?,stack_count=? WHERE catalog_id=? AND revision=? AND stack_count=?')
		.run(state.revision, state.stackCount, state.catalogId, previous.state.revision, previous.state.stackCount);
	if (stateChange.changes !== 1) throw new PhotoStackRevisionConflictError();
	if (state.stackCount === 0) assertLightscaperNativeEmptyStackStateCurrentV1(database, state.catalogId);
}
function readTransaction<Result>(database: DatabaseSync, signal: AbortSignal | undefined, run: () => Result): Result {
	check(signal); if (database.isTransaction) throw new Error('Native stack read requires its own serialized transaction.');
	database.exec('BEGIN');
	try { const result = run(); check(signal); database.exec('COMMIT'); return result; }
	catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native stack read and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
function increment(value: number): number { return integer(value + 1, 0, Number.MAX_SAFE_INTEGER, 'next stack publication revision'); }
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
