/* SPDX-License-Identifier: AGPL-3.0-only */
import {normalizePhotoOriginalV1} from '../src/lightscaper/catalog/photo-document-envelope-v1.ts';
import type {PhotoOriginalV1} from '../src/lightscaper/catalog/types.ts';
import {LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 as MAXIMUM} from './lightscaper-native-original-contract-current-v1.ts';
/** Consumer envelope only. Managed physical Store/index/repair admission stays
 * strict; actual typed body owners independently prove either retention kind. */
export function readLightscaperNativePhotoOriginalEnvelopeCurrentV1(value:unknown):Readonly<PhotoOriginalV1>{
	const original=normalizePhotoOriginalV1(value);if(original.byteLength>MAXIMUM)throw new RangeError('Native Original exceeds its bounded byte profile.');return original;
}
