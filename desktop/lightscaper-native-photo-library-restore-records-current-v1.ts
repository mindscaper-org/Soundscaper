/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { integer } from '../src/lightscaper/catalog/value-validation.ts';
import { normalizePhotoLibraryRestoreAllocationV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';

export const LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_RESTORE_RECEIPT_MAXIMUM_BYTES_CURRENT_V1 = 2_048;
export interface LightscaperNativePhotoLibraryRestoreReceiptCurrentV1 {
	readonly schemaVersion: 1;
	readonly kind: 'native-photo-library-restore-ready';
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly photoCount: number;
	readonly stackCount: number;
	readonly savedCollectionCount: number;
	readonly indexRevision: 0;
	readonly originalCount: number;
	readonly originalByteLength: number;
	readonly catalogInventorySha256: string;
	readonly mediaInventorySha256: string;
}
const FIELDS = ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'photoCount', 'stackCount', 'savedCollectionCount',
	'indexRevision', 'originalCount', 'originalByteLength', 'catalogInventorySha256', 'mediaInventorySha256'] as const;

/** Detached native scalar evidence only. Actual fresh owners and their joined
 * audits mint the opaque publication capability; this normalizer cannot. */
export function normalizeLightscaperNativePhotoLibraryRestoreReceiptCurrentV1(value: unknown,
	allocationValue: unknown): Readonly<LightscaperNativePhotoLibraryRestoreReceiptCurrentV1> {
	const allocation = normalizePhotoLibraryRestoreAllocationV1(allocationValue), label = 'native library restore receipt';
	const input = record(value, label, FIELDS);
	if (field(input, 'schemaVersion', label) !== 1 || field(input, 'kind', label) !== 'native-photo-library-restore-ready') throw new RangeError('Unsupported native restore receipt profile.');
	if (field(input, 'catalogId', label) !== allocation.catalogId) throw new TypeError('Native restore receipt differs from its allocation.');
	const count = (key: string, maximum = Number.MAX_SAFE_INTEGER): number => {
		const raw = field(input, key, label); if (Object.is(raw, -0)) throw new RangeError('Native restore counts require canonical integers.');
		return integer(raw, 0, maximum, 'native restore ' + key);
	};
	const sha = (key: string): string => {
		const raw = field(input, key, label);
		if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/u.test(raw)) throw new TypeError('Native restore inventory requires a complete lowercase SHA-256.'); return raw;
	};
	const photoCount = count('photoCount', 10_000_000), originalCount = count('originalCount', photoCount), originalByteLength = count('originalByteLength');
	if ((photoCount === 0) !== (originalCount === 0) || (originalCount === 0) !== (originalByteLength === 0)
		|| originalByteLength < originalCount) throw new TypeError('Native restore Original counts and bytes disagree.');
	const receipt = Object.freeze({ schemaVersion: 1 as const, kind: 'native-photo-library-restore-ready' as const,
		catalogId: allocation.catalogId, catalogRevision: count('catalogRevision'), photoCount,
		stackCount: count('stackCount', photoCount), savedCollectionCount: count('savedCollectionCount', 10_000), indexRevision: count('indexRevision', 0) as 0,
		originalCount, originalByteLength, catalogInventorySha256: sha('catalogInventorySha256'), mediaInventorySha256: sha('mediaInventorySha256') });
	if (new TextEncoder().encode(JSON.stringify(receipt)).byteLength > LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_RESTORE_RECEIPT_MAXIMUM_BYTES_CURRENT_V1) throw new RangeError('Native restore receipt exceeds its scalar byte limit.');
	return receipt;
}
