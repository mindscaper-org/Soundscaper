/* SPDX-License-Identifier: AGPL-3.0-only */

import { oggPageCrc } from '../../../ogg-page-crc.ts';
import { isDesktopMainAudioCodecRuntime } from '../../../desktop-main-audio-codec-runtime-marker.ts';

const MAXIMUM_ENCODED_BYTES = 32 * 1024 ** 2;
const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;
interface NativeOggFlacGeometry { readonly sampleRate: number; readonly channelCount: number; readonly frameCount: number }

/** The native browser already decodes this Ogg mapping, which the packet demuxer cannot select. */
export async function nativeOggFlacAdmission(file: Blob, options: Readonly<{
	signal?: AbortSignal; codecRuntime?: unknown;
}> = {}): Promise<NativeOggFlacGeometry | null> {
	options.signal?.throwIfAborted();
	if (isDesktopMainAudioCodecRuntime(options.codecRuntime) || file.size < 79 || file.size > MAXIMUM_ENCODED_BYTES) return null;
	// RFC9639: the BOS packet is 51 bytes and occupies its own Ogg page.
	const bytes = new Uint8Array(await file.slice(0, 79).arrayBuffer());
	options.signal?.throwIfAborted();
	if (bytes.length !== 79 || ascii(bytes, 0, 4) !== 'OggS' || bytes[4] !== 0 || bytes[5] !== 2
		|| bytes[26] !== 1 || bytes[27] !== 51 || bytes[28] !== 127 || ascii(bytes, 29, 4) !== 'FLAC'
		|| bytes[33] !== 1 || bytes[34] !== 0 || ascii(bytes, 37, 4) !== 'fLaC'
		|| (bytes[41]! & 127) !== 0 || bytes[42] !== 0 || bytes[43] !== 0 || bytes[44] !== 34) return null;
	const view = new DataView(bytes.buffer);
	if (view.getUint32(18, true) !== 0 || view.getUint32(22, true) !== oggPageCrc(bytes)) return null;
	const packed = view.getBigUint64(55);
	const sampleRate = Number(packed >> 44n), channelCount = Number(packed >> 41n & 7n) + 1;
	const frameCount = Number(packed & 0xf_ffff_ffffn);
	if (sampleRate < 8000 || sampleRate > 192_000 || frameCount < 1 || frameCount * channelCount * 4 > MAXIMUM_PCM_BYTES) return null;
	return Object.freeze({ sampleRate, channelCount, frameCount });
}

/** Do not publish a native decode that differs from the bounded, declared source geometry. */
export function assertNativeOggFlacGeometry(decoded: Readonly<{ sampleRate: number; numberOfChannels: number; length: number }>,
	admission: NativeOggFlacGeometry | null): void {
	if (admission && (decoded.sampleRate !== admission.sampleRate || decoded.numberOfChannels !== admission.channelCount
		|| decoded.length !== admission.frameCount || decoded.length * decoded.numberOfChannels * 4 > MAXIMUM_PCM_BYTES)) {
		throw new RangeError('The native Ogg-FLAC decoder returned different or oversized PCM geometry.');
	}
}

function ascii(bytes: Uint8Array, start: number, length: number): string { return String.fromCharCode(...bytes.subarray(start, start + length)); }
