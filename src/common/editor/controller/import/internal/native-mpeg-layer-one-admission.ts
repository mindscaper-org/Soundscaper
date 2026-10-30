/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../../../../foundation/abort-race.ts';

const BITRATES = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
const SAMPLE_RATES = [44_100, 48_000, 32_000];
const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;
interface Header { readonly sampleRate: number; readonly channelCount: number; readonly byteLength: number }
interface Geometry { readonly sampleRate: number; readonly decodeSampleRate: number; readonly channelCount: number; readonly frameCount: number }

/** Reuse native MPEG1 LayerI decoding only after a complete bounded frame inventory. */
export async function nativeMpegLayerOneAdmission(file: Blob, offset: number, signal?: AbortSignal): Promise<Geometry | null> {
	signal?.throwIfAborted();
	if (file.size > 32 * 1024 ** 2 || !Number.isSafeInteger(offset) || offset < 0 || offset > file.size - 4) return null;
	let profile: Header | null = null, packets = 0;
	while (offset < file.size) {
		const bytes = new Uint8Array(await raceAbortableRead(() => file.slice(offset, offset + 4).arrayBuffer(), signal));
		signal?.throwIfAborted();
		const header = layerOneHeader(bytes);
		if (!header || header.byteLength > file.size - offset
			|| profile && (profile.sampleRate !== header.sampleRate || profile.channelCount !== header.channelCount)) return null;
		profile ??= header;
		packets++;
		if (packets * 384 * profile.channelCount * 4 > MAXIMUM_PCM_BYTES) return null;
		offset += header.byteLength;
		if (packets % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
	}
	if (!profile || packets < 2) return null;
	return Object.freeze({ sampleRate: profile.sampleRate, decodeSampleRate: profile.sampleRate,
		channelCount: profile.channelCount, frameCount: packets * 384 });
}

function layerOneHeader(bytes: Uint8Array): Header | null {
	if (bytes.length !== 4 || bytes[0] !== 255 || (bytes[1]! & 0xfe) !== 0xfe || (bytes[3]! & 3) === 2) return null;
	const bitrate = BITRATES[bytes[2]! >> 4], sampleRate = SAMPLE_RATES[bytes[2]! >> 2 & 3];
	if (!bitrate || !sampleRate) return null;
	return { sampleRate, channelCount: bytes[3]! >> 6 === 3 ? 1 : 2,
		byteLength: (Math.floor(12_000 * bitrate / sampleRate) + (bytes[2]! >> 1 & 1)) * 4 };
}
