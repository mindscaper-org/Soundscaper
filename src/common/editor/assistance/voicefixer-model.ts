/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fixed geometry of the pinned VoiceFixer analysis/vocoder export. */
export const VOICEFIXER_MODEL_ID = 'voicefixer';
export const VOICEFIXER_MODEL_VERSION = '1.0.0';
export const VOICEFIXER_SAMPLE_RATE = 48_000;
export const VOICEFIXER_CHUNK_FRAMES = 240_000;
export const VOICEFIXER_HOP_FRAMES = VOICEFIXER_CHUNK_FRAMES / 2;
export const VOICEFIXER_NATIVE_RATE = 44_100;
export const VOICEFIXER_NATIVE_FRAMES = 220_500;
export const VOICEFIXER_MEL_DIMS = [1, 1, 501, 128] as const;
export const VOICEFIXER_VOCODER_FRAMES = 223_146;
