/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TAKE_COMP_MAXIMUM_ID_CHARACTERS,
	normalizeTakeCompGroupId,
	normalizeTakeId,
	normalizeTakeLaneId,
	type TakeCompGroupId,
	type TakeId,
	type TakeLaneId,
} from './take-comp-domain.ts';

export type TakeMediaPublicationJournalState = 'staged' | 'published' | 'committed';
export type TakeMediaRecoveryDecision = 'recover' | 'discard';

export interface TakeMediaPublicationBinding {
	readonly generation: number;
	readonly groupId: string;
	readonly laneId: string;
	readonly takeId: string;
	readonly mediaId: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface NormalizedTakeMediaPublicationBinding {
	readonly generation: number;
	readonly groupId: TakeCompGroupId;
	readonly laneId: TakeLaneId;
	readonly takeId: TakeId;
	readonly mediaId: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface TakeMediaPublicationJournal {
	readonly journalId: string;
	readonly state: TakeMediaPublicationJournalState;
	readonly binding: NormalizedTakeMediaPublicationBinding;
}

export interface CreateTakeMediaPublicationJournalRequest {
	readonly journalId: string;
	readonly binding: TakeMediaPublicationBinding;
}

export type TakeMediaPublicationJournalEvent = 'media-published' | 'project-committed';

export interface TakeMediaPublicationTransitionRequest {
	readonly event: TakeMediaPublicationJournalEvent;
	readonly currentGeneration: number;
	readonly evidence: TakeMediaPublicationBinding;
}

type DataRecord = Readonly<Record<string, unknown>>;

/** Prepare one external recovery record before any take-media publication. */
export function createTakeMediaPublicationJournal(
	requestValue: unknown,
): TakeMediaPublicationJournal {
	const request = closedRecord(requestValue, 'take media journal creation request', ['journalId', 'binding']);
	const journalId = stableId(request.journalId, 'take media journalId');
	const binding = normalizeBinding(request.binding, 'take media journal binding');
	assertGloballyDistinct(journalId, binding);
	return Object.freeze({ journalId, state: 'staged', binding });
}

/** Authenticate an externally persisted recovery journal before making a decision. */
export function normalizeTakeMediaPublicationJournal(value: unknown): TakeMediaPublicationJournal {
	const journal = closedRecord(value, 'take media publication journal', ['journalId', 'state', 'binding']);
	const journalId = stableId(journal.journalId, 'take media journalId');
	if (journal.state !== 'staged' && journal.state !== 'published' && journal.state !== 'committed') {
		throw new RangeError('Take media journal state must be staged, published, or committed.');
	}
	const binding = normalizeBinding(journal.binding, 'take media journal binding');
	assertGloballyDistinct(journalId, binding);
	return Object.freeze({ journalId, state: journal.state, binding });
}

/** Advance the ordered publication state after authenticating exact durable evidence. */
export function transitionTakeMediaPublicationJournal(
	journalValue: unknown,
	requestValue: unknown,
): TakeMediaPublicationJournal {
	const journal = normalizeTakeMediaPublicationJournal(journalValue);
	const request = closedRecord(requestValue, 'take media publication transition', [
		'event', 'currentGeneration', 'evidence',
	]);
	const currentGeneration = positiveSafeInteger(
		request.currentGeneration,
		'take media currentGeneration',
	);
	assertCurrentGeneration(journal, currentGeneration);
	const evidence = normalizeBinding(request.evidence, 'take media publication evidence');
	assertBindingEvidence(journal.binding, evidence);
	if (request.event !== 'media-published' && request.event !== 'project-committed') {
		throw new RangeError('Take media publication event must be media-published or project-committed.');
	}
	if (request.event === 'media-published') {
		if (journal.state === 'published' || journal.state === 'committed') return journal;
		return freezeJournal(journal, 'published');
	}
	if (journal.state === 'staged') throw new RangeError('Take media journal cannot commit before media publication.');
	if (journal.state === 'committed') return journal;
	return freezeJournal(journal, 'committed');
}

function freezeJournal(
	journal: TakeMediaPublicationJournal,
	state: TakeMediaPublicationJournalState,
): TakeMediaPublicationJournal {
	return Object.freeze({ journalId: journal.journalId, state, binding: journal.binding });
}

function normalizeBinding(value: unknown, name: string): NormalizedTakeMediaPublicationBinding {
	const binding = closedRecord(value, name, [
		'generation', 'groupId', 'laneId', 'takeId', 'mediaId', 'byteLength', 'sha256',
	]);
	const result = Object.freeze({
		generation: positiveSafeInteger(binding.generation, `${name} generation`),
		groupId: normalizeTakeCompGroupId(binding.groupId),
		laneId: normalizeTakeLaneId(binding.laneId),
		takeId: normalizeTakeId(binding.takeId),
		mediaId: stableId(binding.mediaId, `${name} mediaId`),
		byteLength: positiveSafeInteger(binding.byteLength, `${name} byteLength`),
		sha256: sha256(binding.sha256, `${name} sha256`),
	});
	const identities = [result.groupId, result.laneId, result.takeId, result.mediaId];
	if (new Set(identities).size !== identities.length) {
		throw new RangeError('Take media binding identities must be globally distinct.');
	}
	return result;
}

function assertGloballyDistinct(
	journalId: string,
	binding: NormalizedTakeMediaPublicationBinding,
): void {
	if ([binding.groupId, binding.laneId, binding.takeId, binding.mediaId].includes(journalId)) {
		throw new RangeError('Take media journal and media identities must be globally distinct.');
	}
}

function assertCurrentGeneration(
	journal: TakeMediaPublicationJournal,
	currentGeneration: number,
): void {
	if (journal.binding.generation !== currentGeneration) {
		throw new Error(
			`Stale take media journal generation ${String(journal.binding.generation)}; current generation is ${String(currentGeneration)}.`,
		);
	}
}

function assertBindingEvidence(
	expected: NormalizedTakeMediaPublicationBinding,
	actual: NormalizedTakeMediaPublicationBinding,
): void {
	if (actual.generation !== expected.generation) {
		throw new Error('Take media evidence generation does not match its journal.');
	}
	if (actual.groupId !== expected.groupId || actual.laneId !== expected.laneId
		|| actual.takeId !== expected.takeId || actual.mediaId !== expected.mediaId) {
		throw new Error('Take media evidence identity does not match its journal.');
	}
	if (actual.byteLength !== expected.byteLength) {
		throw new Error('Take media evidence byteLength does not match its journal.');
	}
	if (actual.sha256 !== expected.sha256) {
		throw new Error('Take media evidence digest does not match its journal.');
	}
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	if (value.length > TAKE_COMP_MAXIMUM_ID_CHARACTERS) {
		throw new RangeError(`${name} cannot exceed ${String(TAKE_COMP_MAXIMUM_ID_CHARACTERS)} characters.`);
	}
	return value;
}

function sha256(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`${name} must be a canonical lowercase SHA-256 digest.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function closedRecord(value: unknown, name: string, requiredKeys: readonly string[]): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const keys = Reflect.ownKeys(record);
	const allowed = new Set(requiredKeys);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))
		|| requiredKeys.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	return Object.freeze(result);
}
