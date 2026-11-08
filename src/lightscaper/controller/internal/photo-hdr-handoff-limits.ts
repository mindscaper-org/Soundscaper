/* SPDX-License-Identifier: AGPL-3.0-only */

import { IMAGE_HDR_ORIGINAL_LIMITS_V1 } from '../../../common/editor/imaging/image-hdr-original-profile-v1.ts';

/** Scalar admission only; importing capacities grants no image authoring or body authority. */
export const PHOTO_HDR_HANDOFF_LIMITS_CURRENT_V1 = Object.freeze({ originalBytes: IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumEncodedBytes,
	bodyBytes: 384 * 1024 * 1024, archiveBytes: 512 * 1024 * 1024, workingBytes: 1024 * 1024 * 1024 });
