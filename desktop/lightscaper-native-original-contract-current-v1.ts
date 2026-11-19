/* SPDX-License-Identifier: AGPL-3.0-only */

import { IMAGE_IMPORT_LIMITS } from '../src/common/imaging/image-import-admission.ts';
import { IMAGE_HDR_ORIGINAL_LIMITS_V1 } from '../src/common/editor/imaging/image-hdr-original-profile-v1.ts';
import { normalizePhotoOriginalV1 } from '../src/lightscaper/catalog/photo-document-envelope-v1.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';

/** Storage admission bounds bytes only. Current import/render/HDR owners still
 * authenticate the actual container, geometry, provenance and decoded workload. */
export const LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 = Math.max(
	IMAGE_IMPORT_LIMITS.maximumFileInputBytes, IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumEncodedBytes,
);
export const LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 = 1024 * 1024;

/** The exact existing twelve-field Original envelope supplies inert closed
 * capture, stable IDs, exact safe filename, canonical image MIME, SHA-256 and
 * scalar dimensions. Native custody admits only its managed retention branch. */
export function readLightscaperNativeOriginalCurrentV1(value: unknown): Readonly<PhotoOriginalV1> {
	const original = normalizePhotoOriginalV1(value);
	if (original.retention !== 'managed') throw new TypeError('Native Original custody requires managed retention.');
	if (original.byteLength > LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1) throw new RangeError('Native Original exceeds its bounded stored byte profile.');
	return original;
}

/** Opaque metadata identity only. Filesystem paths derive from the verified
 * content digest under the main-owned root, never from this storage key. */
export function readLightscaperNativeOriginalStorageKeyCurrentV1(value: unknown): string {
	return id(value, 'native Original storage key');
}
