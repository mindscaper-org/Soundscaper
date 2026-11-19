/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitPhotoSmartCollectionSaveV1, readPhotoSmartCollectionWriteOptionsV1, smartCollectionRevisionV1,
	type PhotoSmartCollectionWriteOptionsV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import type { PhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';

interface Common {
	readonly catalogId: string;
	readonly collectionId: string;
	readonly options: Readonly<PhotoSmartCollectionWriteOptionsV1>;
}
export interface AdmittedLightscaperNativeSmartCollectionSaveCurrentV1 extends Common {
	readonly kind: 'save';
	readonly expected: number | null;
	readonly candidate: Readonly<PhotoSmartCollectionV1>;
}
export interface AdmittedLightscaperNativeSmartCollectionDeleteCurrentV1 extends Common {
	readonly kind: 'delete';
	readonly expected: number;
	readonly candidate: null;
}
export type AdmittedLightscaperNativeSmartCollectionWriteCurrentV1 = AdmittedLightscaperNativeSmartCollectionSaveCurrentV1
	| AdmittedLightscaperNativeSmartCollectionDeleteCurrentV1;
const packets = new WeakSet<object>();

/** Closed, detached capture completes before the owner's first queue wait. */
export function admitLightscaperNativeSmartCollectionSaveCurrentV1(value: unknown, expectedValue: unknown,
	options: unknown): AdmittedLightscaperNativeSmartCollectionSaveCurrentV1 {
	const candidate = admitPhotoSmartCollectionSaveV1(value, expectedValue);
	const expected = expectedValue === null ? null : smartCollectionRevisionV1(expectedValue);
	const admitted = readPhotoSmartCollectionWriteOptionsV1(options);
	const packet = Object.freeze({ kind: 'save' as const, catalogId: candidate.catalogId, collectionId: candidate.id,
		expected, candidate, options: admitted });
	packets.add(packet); return packet;
}
export function admitLightscaperNativeSmartCollectionDeleteCurrentV1(catalogValue: unknown, collectionValue: unknown,
	expectedValue: unknown, options: unknown): AdmittedLightscaperNativeSmartCollectionDeleteCurrentV1 {
	const catalogId = id(catalogValue, 'saved collection catalog ID'), collectionId = id(collectionValue, 'saved collection ID');
	const expected = smartCollectionRevisionV1(expectedValue), admitted = readPhotoSmartCollectionWriteOptionsV1(options);
	const packet = Object.freeze({ kind: 'delete' as const, catalogId, collectionId, expected, candidate: null, options: admitted });
	packets.add(packet); return packet;
}
export function readAdmittedLightscaperNativeSmartCollectionWriteCurrentV1(value: unknown): AdmittedLightscaperNativeSmartCollectionWriteCurrentV1 {
	if (value === null || typeof value !== 'object' || !packets.has(value)) throw new TypeError('An owning admitted native saved collection request is required.');
	return value as AdmittedLightscaperNativeSmartCollectionWriteCurrentV1;
}
