/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../../../abort-race.ts';
import { inspectMp3GaplessGeometry } from '../../../mp3-gapless-import.ts';

interface Geometry { readonly sampleRate: number; readonly channelCount: number; readonly frameCount: number; readonly decodeSampleRate: number }
const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;

/** Native decoders may support free-format MPEG1 Layer III, which the packet demuxer does not. */
export async function nativeFreeFormatMp3Admission(file: Blob, offset: number, signal?: AbortSignal): Promise<Geometry | null> {
	signal?.throwIfAborted();
	if (file.size > 32 * 1024 ** 2 || offset < 0 || offset > file.size - 4) return null;
	const prefix = await read(file, offset, Math.min(offset + 4096, file.size), signal);
	if (!freeHeader(prefix)) return null;
	// Probe the existing bounded Info/LAME geometry using owned bytes, never a pending native range.
	const geometry = await inspectMp3GaplessGeometry(new Blob([prefix]));
	signal?.throwIfAborted();
	if (!geometry) return null;
	const channelCount = prefix[3]! >> 6 === 3 ? 1 : 2;
	const frames = geometry.encodedFrames / 1152 + 1; // Include the non-audio Info frame.
	if (!Number.isSafeInteger(frames) || frames < 2 || geometry.sourceFrames * channelCount * 4 > MAXIMUM_PCM_BYTES
		|| geometry.encodedFrames * channelCount * 4 > MAXIMUM_PCM_BYTES + 8192 * channelCount * 4) return null;
	const meanBytes = Math.floor((file.size - offset) / frames);
	// A constant free bitrate may still add the MPEG one-byte padding slot per frame.
	for (const baseBytes of [meanBytes, meanBytes - 1]) {
		if (baseBytes < 24 || baseBytes * geometry.sampleRate / 144 > 640_000) continue;
		let position = offset;
		for (let frame = 0; frame < frames; frame++) {
			const header = await read(file, position, Math.min(position + 4, file.size), signal);
			if (!freeHeader(header) || (header[2]! & 12) !== (prefix[2]! & 12)
				|| (header[3]! >> 6 === 3 ? 1 : 2) !== channelCount) break;
			position += baseBytes + (header[2]! >> 1 & 1);
			if (position > file.size) break;
			if (frame === frames - 1 && position === file.size) return Object.freeze({
				sampleRate: geometry.sampleRate, decodeSampleRate: geometry.sampleRate, channelCount, frameCount: geometry.sourceFrames,
			});
			if (frame % 64 === 63) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
		}
	}
	return null;
}

function freeHeader(bytes: Uint8Array): boolean {
	return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 251 && bytes[2]! >> 4 === 0
		&& (bytes[2]! >> 2 & 3) !== 3 && (bytes[3]! & 3) !== 2;
}
async function read(file: Blob, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	signal?.throwIfAborted();
	const bytes = await raceAbortableRead(() => file.slice(start, end).arrayBuffer(), signal);
	signal?.throwIfAborted();
	return new Uint8Array(bytes);
}
