/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoStackV1, normalizePhotoStackStateV1, PHOTO_STACK_LIMITS_V1, type PhotoStackV1, type PhotoStackStateV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { field, id, integer, record } from '../src/lightscaper/catalog/value-validation.ts';

export interface LightscaperNativeStackMemberCurrentV1 {
	readonly photoKey: string;
	readonly catalogId: string;
	readonly photoId: string;
	readonly stackKey: string;
	readonly stackId: string;
	readonly memberPosition: number;
}

/** Pages retain scalar summaries only after one bounded whole stack has passed
 * its owning shared validator and every native scalar has been authenticated. */
export function readLightscaperNativeStackRowCurrentV1(value: unknown, expectedCatalogId?: string, expectedStackId?: string): Readonly<PhotoStackV1> {
	const input = record(value, 'native photo stack row', ['stack_key', 'catalog_id', 'stack_id', 'revision', 'document', 'photo_count', 'cover_photo_id']);
	const catalogId = id(field(input, 'catalog_id'), 'native stack catalog ID'), stackId = id(field(input, 'stack_id'), 'native stack ID');
	if (field(input, 'stack_key') !== photoStorageKey(catalogId, stackId)
		|| (expectedCatalogId !== undefined && catalogId !== id(expectedCatalogId, 'requested stack catalog ID'))
		|| (expectedStackId !== undefined && stackId !== id(expectedStackId, 'requested stack ID'))) throw new TypeError('Native stack key disagrees with its requested identity.');
	const text = field(input, 'document');
	if (typeof text !== 'string') throw new TypeError('Native stack requires JSON document text.');
	if (text.length > PHOTO_STACK_LIMITS_V1.maximumDocumentBytes || Buffer.byteLength(text, 'utf8') > PHOTO_STACK_LIMITS_V1.maximumDocumentBytes) {
		throw new RangeError('Native stack exceeds its document byte budget.');
	}
	const parsed: unknown = JSON.parse(text), stack = normalizePhotoStackV1(parsed);
	if (stack.catalogId !== catalogId || stack.id !== stackId || stack.revision !== field(input, 'revision')
		|| stack.photoIds.length !== field(input, 'photo_count') || stack.coverPhotoId !== field(input, 'cover_photo_id')) {
		throw new TypeError('Native stack document disagrees with its scalar identity, revision, count or cover.');
	}
	return stack;
}

export function readLightscaperNativeStackStateRowCurrentV1(value: unknown, expectedCatalogId?: string): Readonly<PhotoStackStateV1> {
	const input = record(value, 'native photo stack state row', ['catalog_id', 'revision', 'stack_count']);
	const catalogId = id(field(input, 'catalog_id'), 'native stack state catalog ID');
	if (expectedCatalogId !== undefined && catalogId !== id(expectedCatalogId, 'requested stack state catalog ID')) throw new TypeError('Native stack state belongs to another catalog.');
	return normalizePhotoStackStateV1({ schemaVersion: 1, kind: 'photo-stack-state', catalogId,
		revision: field(input, 'revision'), stackCount: field(input, 'stack_count') });
}

/** The same exact row shape authenticates independently owned forward and
 * reverse relations; equality with the stack's ordered document is caller-owned. */
export function readLightscaperNativeStackMemberRowCurrentV1(value: unknown, expectedCatalogId?: string): Readonly<LightscaperNativeStackMemberCurrentV1> {
	const input = record(value, 'native photo stack member row', ['photo_key', 'catalog_id', 'photo_id', 'stack_key', 'stack_id', 'member_position']);
	const catalogId = id(field(input, 'catalog_id'), 'native stack member catalog ID'), photoId = id(field(input, 'photo_id'), 'native stack member photo ID');
	const stackId = id(field(input, 'stack_id'), 'native member stack ID');
	const photoKey = photoStorageKey(catalogId, photoId), stackKey = photoStorageKey(catalogId, stackId);
	if (field(input, 'photo_key') !== photoKey || field(input, 'stack_key') !== stackKey
		|| (expectedCatalogId !== undefined && catalogId !== id(expectedCatalogId, 'requested stack member catalog ID'))) {
		throw new TypeError('Native stack member keys disagree with their scoped identities.');
	}
	return Object.freeze({ photoKey, catalogId, photoId, stackKey, stackId,
		memberPosition: integer(field(input, 'member_position'), 0, PHOTO_STACK_LIMITS_V1.maximumPhotos - 1, 'native stack member position') });
}
