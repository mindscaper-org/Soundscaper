/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoStackV1, PHOTO_STACK_LIMITS_V1 as LIMITS, type PhotoStackV1 } from './photo-stack-v1.ts';
import { photoStorageKey } from './repository-records.ts';
import { array, field, id, integer, record, unique } from './value-validation.ts';

const throwIfAborted = AbortSignal.prototype.throwIfAborted;

export interface PhotoStackWriteOptionsV1 {
	readonly expectedCatalogRevision: number;
	readonly expectedStateRevision: number;
	readonly signal?: AbortSignal;
}
export interface PhotoStackContinuationV1 {
	readonly catalogId: string;
	readonly scope: 'stacks' | 'memberships';
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly stateRevision: number;
	readonly afterKey: string;
}
export interface PhotoStackPageOptionsV1 {
	readonly continuation?: PhotoStackContinuationV1 | null;
	readonly signal?: AbortSignal;
}
export interface PhotoStackMembershipPageOptionsV1 extends PhotoStackPageOptionsV1 {
	readonly photoIds?: readonly string[];
}
export interface PhotoStackSummaryV1 {
	readonly catalogId: string;
	readonly id: string;
	readonly revision: number;
	readonly photoCount: number;
	readonly coverPhotoId: string;
}
export interface PhotoStackMembershipV1 {
	readonly catalogId: string;
	readonly photoId: string;
	readonly stackId: string;
}
export interface PhotoStackMemberSummaryV1 { readonly photoId: string; readonly fileName: string; readonly photoRevision: number }
export interface PhotoStackPageV1<Item> {
	readonly items: readonly Item[];
	readonly continuation: Readonly<PhotoStackContinuationV1> | null;
}
export class PhotoStackRevisionConflictError extends Error {
	readonly code = 'STACK_REVISION_CONFLICT';
	constructor() { super('The stack or stack state revision changed; reload before publishing.'); this.name = 'PhotoStackRevisionConflictError'; }
}

/** Closed stack admission precedes acquiring either storage engine. */
export function readPhotoStackWriteOptionsV1(value: unknown): Readonly<PhotoStackWriteOptionsV1> {
	const input = record(value, 'stack write options', ['expectedCatalogRevision', 'expectedStateRevision', 'signal'], ['expectedCatalogRevision', 'expectedStateRevision']);
	return Object.freeze({ expectedCatalogRevision: revision(field(input, 'expectedCatalogRevision')),
		expectedStateRevision: revision(field(input, 'expectedStateRevision')), ...readSignal(input) });
}
export function readPhotoStackPageOptionsV1(value: unknown, catalogId: string, scope: 'stacks' | 'memberships'): Readonly<PhotoStackMembershipPageOptionsV1> {
	const input = record(value, 'stack page options', scope === 'stacks' ? ['continuation', 'signal'] : ['continuation', 'signal', 'photoIds'], []);
	const raw = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : null;
	const continuation = raw === null ? null : readContinuation(raw, catalogId, scope);
	const photoIds = Object.hasOwn(input, 'photoIds') ? array(field(input, 'photoIds'), 'stack annotation photos', 0, LIMITS.pageSize).map((entry) => id(entry, 'annotation photo ID')) : undefined;
	if (photoIds) unique(photoIds, 'annotation photos');
	if (photoIds && continuation) throw new TypeError('Point annotations cannot carry a cursor.');
	return Object.freeze({ continuation, ...(photoIds ? { photoIds: Object.freeze(photoIds) } : {}), ...readSignal(input) });
}
export function readPhotoStackSignalOptionsV1(value: unknown): Readonly<{ signal?: AbortSignal }> {
	return Object.freeze(readSignal(record(value, 'stack read options', ['signal'], [])));
}
export function admitPhotoStackSaveV1(value: unknown, expectedRevision: unknown): PhotoStackV1 {
	const stack = normalizePhotoStackV1(value);
	const expected = expectedRevision === null ? null : revision(expectedRevision);
	if (stack.revision !== (expected ?? 0)) throw new RangeError('Stack candidate revision disagrees with expected revision.');
	return stack;
}
export function admitPhotoStackMemberIdsV1(value: unknown): readonly string[] {
	const ids = array(value, 'stack member page IDs', 1, LIMITS.pageSize).map(entry => id(entry, 'stack member photo ID'));
	unique(ids, 'stack member page IDs'); return Object.freeze(ids);
}

function readContinuation(value: unknown, catalogId: string, scope: 'stacks' | 'memberships'): PhotoStackContinuationV1 {
	const input = record(value, 'stack continuation', ['catalogId', 'scope', 'catalogRevision', 'indexRevision', 'stateRevision', 'afterKey']);
	const key = field(input, 'afterKey');
	if (field(input, 'catalogId') !== catalogId || field(input, 'scope') !== scope || typeof key !== 'string'
		|| !key.startsWith(`${catalogId}|`) || key !== photoStorageKey(catalogId, key.slice(catalogId.length + 1))) throw new TypeError('Stack continuation belongs to another catalog or scope.');
	return Object.freeze({ catalogId, scope, afterKey: key, catalogRevision: revision(field(input, 'catalogRevision')),
		indexRevision: revision(field(input, 'indexRevision')), stateRevision: revision(field(input, 'stateRevision')) });
}
function readSignal(input: Readonly<Record<string, unknown>>): Readonly<{ signal?: AbortSignal }> {
	if (!Object.hasOwn(input, 'signal')) return {};
	const signal = field(input, 'signal'); if (signal === undefined) return {};
	if (!signal || typeof signal !== 'object' || Object.getPrototypeOf(signal) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) throw new TypeError('Stack operation requires a native AbortSignal.');
	Reflect.apply(throwIfAborted, signal, []);
	return { signal: signal as AbortSignal };
}
function revision(value: unknown): number { return integer(value, 0, Number.MAX_SAFE_INTEGER, 'stack expected revision'); }
