/* SPDX-License-Identifier: AGPL-3.0-only */

import { metadataBlobBytes } from './audio-metadata-values.ts';
import { oggPageCrc } from './ogg-page-crc.ts';

const MAXIMUM_PREFIX_PAGES = 4096;
const UNKNOWN_GRANULE = 0xffff_ffff_ffff_ffffn;

/** RFC 7845 section 4.5 permits cropped/live streams to retain an absolute
 * granule origin. Derive it from the first completed audio page, retaining
 * only page-sized PCM-independent reads and two bytes of each packet header.
 */
export async function inspectOpusInitialGranule(file: Blob, serial: number, signal?: AbortSignal): Promise<number> {
	let offset = 0;
	let packetIndex = 0;
	let headerLength = 0;
	let decodedSamples = 0;
	const packetHeader = new Uint8Array(2);
	for (let pages = 0; offset < file.size && pages < MAXIMUM_PREFIX_PAGES; pages++) {
		const header = await metadataBlobBytes(file, offset, offset + 27, signal);
		if (String.fromCharCode(...header.subarray(0, 4)) !== 'OggS' || header[4] || header[5]! & ~7) {
			throw new RangeError('Invalid Ogg page while inspecting the Opus granule origin.');
		}
		const laces = await metadataBlobBytes(file, offset + 27, offset + 27 + header[26]!, signal);
		const size = 27 + laces.length + laces.reduce((sum, length) => sum + length, 0);
		if (size > file.size - offset) throw new RangeError('The initial Opus page is truncated.');
		const view = new DataView(header.buffer);
		if (view.getUint32(14, true) === serial) {
			const endings = laces.reduce((sum, length) => sum + Number(length < 255), 0);
			if (packetIndex < 2 && (packetIndex + endings < 2
				|| packetIndex + endings === 2 && (laces.at(-1) ?? 255) < 255)) packetIndex += endings;
			else {
				const page = await metadataBlobBytes(file, offset, offset + size, signal);
				if (view.getUint32(22, true) !== oggPageCrc(page)) throw new Error('The Ogg source page checksum failed.');
				let bodyOffset = 27 + laces.length;
				let completedAudio = false;
				for (const length of laces) {
					if (packetIndex >= 2) {
						for (let index = 0; index < length && headerLength < 2; index++) packetHeader[headerLength++] = page[bodyOffset + index]!;
						if (length < 255) {
							decodedSamples += opusPacketSamples(packetHeader, headerLength);
							headerLength = 0;
							completedAudio = true;
						}
					}
					bodyOffset += length;
					if (length < 255) packetIndex++;
				}
				const granule = view.getBigUint64(6, true);
				if (completedAudio && granule !== UNKNOWN_GRANULE) {
					if (granule > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('The initial Opus granule exceeds the safe range.');
					if (granule < BigInt(decodedSamples) && !(header[5]! & 4)) throw new RangeError('The initial Opus granule precedes its completed packets.');
					return Math.max(0, Number(granule) - decodedSamples);
				}
			}
		}
		offset += size;
	}
	throw new RangeError('The Opus source has no bounded initial audio granule.');
}

/** RFC 6716 section 3: TOC configuration determines samples per frame and
 * framing code determines the packet's frame count (at most 120 ms total).
 */
function opusPacketSamples(header: Uint8Array, length: number): number {
	if (!length) throw new RangeError('The initial Opus packet is empty.');
	const toc = header[0]!;
	const config = toc >>> 3;
	const frameSamples = config >= 16 ? 120 * 2 ** (config & 3)
		: config >= 12 ? 480 * 2 ** (config & 1) : [480, 960, 1920, 2880][config & 3]!;
	const code = toc & 3;
	if (code === 3 && length < 2) throw new RangeError('The initial Opus packet frame count is missing.');
	const count = code === 0 ? 1 : code < 3 ? 2 : header[1]! & 63;
	const samples = frameSamples * count;
	if (!count || samples > 5760) throw new RangeError('The initial Opus packet exceeds its duration bound.');
	return samples;
}
