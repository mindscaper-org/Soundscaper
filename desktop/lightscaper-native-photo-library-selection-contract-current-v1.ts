/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';
import { normalizePhotoLibraryRestoreAllocationV1, type PhotoLibraryRestoreAllocationV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { normalizeLightscaperNativePhotoLibraryRestoreReceiptCurrentV1,
	type LightscaperNativePhotoLibraryRestoreReceiptCurrentV1 } from './lightscaper-native-photo-library-restore-records-current-v1.ts';

export const LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_SELECTION_KEY_CURRENT_V1 = 'photo-library:native-selected-v1';
export const LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_ACTIVE_RESTORE_KEY_CURRENT_V1 = 'photo-library:native-restore-active-v1';
export const LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_SELECTION_MAXIMUM_BYTES_CURRENT_V1 = 4096;
export const LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_COMMIT_MAXIMUM_BYTES_CURRENT_V1 = 4096;
export interface LightscaperNativePhotoLibrarySelectionCurrentV1 {
	readonly schemaVersion: 1;
	readonly kind: 'native-photo-library-selection';
	readonly selectionToken: string;
	readonly catalogId: string;
	readonly namespaceToken: string | null;
}
export interface LightscaperNativePhotoLibraryCommitCurrentV1 {
	readonly schemaVersion: 1;
	readonly kind: 'native-photo-library-restore-commit';
	readonly previous: Readonly<LightscaperNativePhotoLibrarySelectionCurrentV1>;
	readonly replacement: Readonly<LightscaperNativePhotoLibrarySelectionCurrentV1>;
	readonly allocation: Readonly<PhotoLibraryRestoreAllocationV1>;
	readonly registryOwner: string;
	readonly manifestSha256: string;
	readonly receipt: Readonly<LightscaperNativePhotoLibraryRestoreReceiptCurrentV1>;
}
const POINTER_FIELDS = ['schemaVersion', 'kind', 'selectionToken', 'catalogId', 'namespaceToken'] as const;
const COMMIT_FIELDS = ['schemaVersion', 'kind', 'previous', 'replacement', 'allocation', 'registryOwner', 'manifestSha256', 'receipt'] as const;

/** Pure detached scalar profile only. The fixed native anchor reader retains
 * the actual entry and its insertion order separately for physical CAS.
 * Successful admission grants no scope, readiness, deletion or write authority. */
export function readLightscaperNativePhotoLibrarySelectionCurrentV1(value: unknown): Readonly<LightscaperNativePhotoLibrarySelectionCurrentV1> {
	const input = record(value, 'native library selection', POINTER_FIELDS);
	if (field(input, 'schemaVersion', 'native library selection') !== 1 || field(input, 'kind', 'native library selection') !== 'native-photo-library-selection') throw new RangeError('Unsupported native library selection profile.');
	const namespace = field(input, 'namespaceToken', 'native library selection');
	const selected = Object.freeze({ schemaVersion: 1 as const, kind: 'native-photo-library-selection' as const,
		selectionToken: hex(field(input, 'selectionToken', 'native library selection'), 32),
		catalogId: id(field(input, 'catalogId', 'native library selection'), 'native selected catalog ID'),
		namespaceToken: namespace === null ? null : hex(namespace, 32) });
	bytes(selected, LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_SELECTION_MAXIMUM_BYTES_CURRENT_V1); return selected;
}

/** Permanent history binds native installation facts to its exact allocation.
 * The trusted publisher separately requires a genuine one-use Ready permit. */
export function readLightscaperNativePhotoLibraryCommitCurrentV1(value: unknown): Readonly<LightscaperNativePhotoLibraryCommitCurrentV1> {
	const input = record(value, 'native library permanent commit', COMMIT_FIELDS);
	const get = (key: string): unknown => field(input, key, 'native library permanent commit');
	if (get('schemaVersion') !== 1 || get('kind') !== 'native-photo-library-restore-commit') throw new RangeError('Unsupported native library permanent commit profile.');
	const previous = readLightscaperNativePhotoLibrarySelectionCurrentV1(get('previous')),
		replacement = readLightscaperNativePhotoLibrarySelectionCurrentV1(get('replacement')),
		allocation = normalizePhotoLibraryRestoreAllocationV1(get('allocation'));
	if (replacement.catalogId !== allocation.catalogId || replacement.namespaceToken !== allocation.namespaceToken
		|| previous.namespaceToken === allocation.namespaceToken || previous.selectionToken === replacement.selectionToken) throw new TypeError('Native library replacement differs from its fresh allocation or selection epoch.');
	const commit = Object.freeze({ schemaVersion: 1 as const, kind: 'native-photo-library-restore-commit' as const,
		previous, replacement, allocation, registryOwner: hex(get('registryOwner'), 32), manifestSha256: hex(get('manifestSha256'), 64),
		receipt: normalizeLightscaperNativePhotoLibraryRestoreReceiptCurrentV1(get('receipt'), allocation) });
	bytes(commit, LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_COMMIT_MAXIMUM_BYTES_CURRENT_V1); return commit;
}
export function lightscaperNativePhotoLibraryCommitKeyCurrentV1(namespaceToken: unknown): string {
	return `photo-library:native-restore-commit-v1:${hex(namespaceToken, 32)}`;
}
function hex(value: unknown, length: 32 | 64): string {
	if (typeof value !== 'string' || value.length !== length || !/^[a-f0-9]+$/u.test(value)) throw new TypeError('Native library token or digest is not exact lowercase hexadecimal.');
	return value;
}
function bytes(value: unknown, maximum: number): void {
	if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maximum) throw new RangeError('Native library scalar profile exceeds its encoded byte bound.');
}
