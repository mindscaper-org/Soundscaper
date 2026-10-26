/* SPDX-License-Identifier: AGPL-3.0-only */

/** Storage and source activation share these PCM allocation boundaries. */
export const SOURCE_CHUNK_FRAMES = 65_536;
export const SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES = 32 * 1024 * 1024;

/** Native cache capabilities can be narrower than the admitted stored PCM format. */
export function isUnsupportedNativeAudioBuffer(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'NotSupportedError';
}
