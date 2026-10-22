/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopAudioCodecFormat } from './desktop-audio-codec-operation-contract.ts';

/** Import-only profiles never enter the encode/export format register. */
export const DESKTOP_AUDIO_DECODE_ONLY_FORMATS = Object.freeze([
	'matroska-mp3', 'wma', 'wav-mulaw', 'wav-alaw',
] as const);
export type DesktopAudioDecodeOnlyFormat = typeof DESKTOP_AUDIO_DECODE_ONLY_FORMATS[number];
export type DesktopAudioDecodeFormat = DesktopAudioCodecFormat | DesktopAudioDecodeOnlyFormat;

const DECODE_ONLY_FORMATS = new Set<string>(DESKTOP_AUDIO_DECODE_ONLY_FORMATS);
const ENCODE_FORMATS = new Set(['flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a']);

export function desktopAudioDecodeFormat(value: unknown): DesktopAudioDecodeFormat {
	if (typeof value !== 'string' || !(DECODE_ONLY_FORMATS.has(value) || ENCODE_FORMATS.has(value))) {
		throw new TypeError('The desktop audio decode format is unsupported.');
	}
	return value as DesktopAudioDecodeFormat;
}

export function maximumDesktopAudioChannelCount(format: DesktopAudioDecodeFormat): number {
	return format === 'mp3' || format === 'mp2' || format === 'matroska-mp3' ? 2 : 8;
}

/** A WAV extension alone cannot select a companded decoder. Prove the fmt tag. */
export function inspectDesktopCompandedWaveFormat(bytes: Uint8Array): DesktopAudioDecodeOnlyFormat | null {
	if (text(bytes, 0, 4) !== 'RIFF' || text(bytes, 8, 4) !== 'WAVE' || bytes.length < 12) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		if (size > bytes.length - offset - 8) return null;
		if (text(bytes, offset, 4) === 'fmt ') {
			if (size < 16) return null;
			const format = view.getUint16(offset + 8, true);
			return format === 7 ? 'wav-mulaw' : format === 6 ? 'wav-alaw' : null;
		}
		offset += 8 + size + size % 2;
	}
	return null;
}

function text(bytes: Uint8Array, offset: number, count: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + count));
}
