/* SPDX-License-Identifier: AGPL-3.0-only */

import { createReviewedAudioCodecRuntime } from './reviewed-audio-codec-runtime.ts';

/** Replace the browser worker transport while retaining its shipping codec runtime and WASM. */
export function createDefaultWavPackGroupDecoder() {
	return createReviewedAudioCodecRuntime();
}
