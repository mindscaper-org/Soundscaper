/* SPDX-License-Identifier: AGPL-3.0-only */

import { captureLightscaperNativePhotoMediaMetadataCurrentV1 as capture, readLightscaperNativePhotoMediaMetadataCurrentV1 as read } from './lightscaper-native-photo-media-metadata-current-v1.ts';
import { decodeLightscaperNativePhotoSettingCurrentV1 as decode } from './lightscaper-native-photo-settings-codec-current-v1.ts';
import { captureDesktopPhotoCloneCurrentV1 as encode, measureDesktopPhotoCloneCurrentV1 as measure, retireDesktopPhotoCloneCurrentV1 as retire } from '../src/lightscaper/desktop-photo-clone-current-v1.ts';

export const LIGHTSCAPER_NATIVE_PHOTO_SESSION_METADATA_MAXIMUM_BYTES_CURRENT_V1 = 134_217_728;
const RECEIPT_ALLOWANCE = 4096;

/** Preflight the actual native descriptive normalization, including its new
 * shallow root around cyclic input. This capture supplies no body authority.
 * The real writer receives the original owned decoded value and performs the
 * unchanged same normalization/publisher. Six fixed native receipt fields fit
 * the reserved4KiB (128ASCII key,64SHA,safe size,fixed storage,two ISO stamps). */
export async function preflightLightscaperNativePhotoSessionMetadataCurrentV1(assetId: string, metadata: unknown,
	inputDebt: number, charge: (debt: number) => void): Promise<void> {
	let payload: Uint8Array | undefined, wire: unknown;
	try {
		const captured = await capture(assetId, metadata); payload = read(captured).metadataPayload;
		const descriptive: unknown = decode(payload);
		if (!descriptive || typeof descriptive !== 'object') throw new TypeError('Native normalized metadata requires its actual descriptive record.');
		// Capacity only: these six bounded slots also reserve codec field count.
		// This graph never leaves preflight or supplies a publication receipt.
		wire = await encode({ ...descriptive, sourceId: assetId, sha256: 'f'.repeat(64), size: Number.MAX_SAFE_INTEGER,
			storage: 'native-photo-original', committedAt: '+999999-12-31T23:59:59.999Z', pendingProjectUntil: '+999999-12-31T23:59:59.999Z' });
		const replyDebt = measure(wire);
		if (replyDebt > LIGHTSCAPER_NATIVE_PHOTO_SESSION_METADATA_MAXIMUM_BYTES_CURRENT_V1 - RECEIPT_ALLOWANCE) throw new RangeError('Native metadata reply exceeds its retained transfer capacity.');
		charge(Math.max(inputDebt, replyDebt + RECEIPT_ALLOWANCE));
	} finally { if (payload) payload.fill(0); retire(wire); }
}
