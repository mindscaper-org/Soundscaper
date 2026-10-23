/* SPDX-License-Identifier: AGPL-3.0-only */

import { metadataBlobBytes, metadataBytes } from './audio-metadata-values.ts';
import { oggPageCrc } from './ogg-page-crc.ts';

const MAXIMUM_METADATA_BYTES = 16 * 1024 ** 2;
const MAXIMUM_METADATA_BLOCKS = 128;
const MAXIMUM_PAGES = 4096;

/** RFC9639 carries ordinary FLAC metadata blocks in Ogg header packets.
 * Give the existing FLAC tag reader those bounded blocks, without audio reads.
 */
export async function oggFlacMetadataReadView(file: Blob, header: Uint8Array, signal?: AbortSignal): Promise<Blob | null> {
	if (file.size < 79 || ascii(header.subarray(0, 4)) !== 'OggS') return null;
	const first = await metadataBlobBytes(file, 0, 79, signal);
	if (first[4] !== 0 || first[5] !== 2 || first[26] !== 1 || first[27] !== 51
		|| first[28] !== 127 || ascii(first.subarray(29, 33)) !== 'FLAC' || first[33] !== 1 || first[34] !== 0) return null;
	const view = new DataView(first.buffer);
	if (view.getUint32(18, true) !== 0 || view.getUint32(22, true) !== oggPageCrc(first)
		|| ascii(first.subarray(37, 41)) !== 'fLaC' || (first[41]! & 127) !== 0
		|| first[42] !== 0 || first[43] !== 0 || first[44] !== 34) throw new RangeError('Invalid Ogg-FLAC identification header.');
	const declaredPackets = view.getUint16(35);
	if (declaredPackets > MAXIMUM_METADATA_BLOCKS - 1) throw new RangeError('The Ogg-FLAC metadata exceeds its block bound.');
	const serial = view.getUint32(14, true);
	const parts: BlobPart[] = [first.slice(37)];
	let offset = 79, sequence = 1, pageCount = 1, blockCount = 1, totalBytes = 38;
	let packetParts: Uint8Array[] = [], packetLength = 0;
	let last = Boolean(first[41]! & 128);
	while (!last) {
		if (++pageCount > MAXIMUM_PAGES) throw new RangeError('The Ogg-FLAC metadata exceeds its page bound.');
		const pageHeader = await metadataBlobBytes(file, offset, offset + 27, signal);
		if (ascii(pageHeader.subarray(0, 4)) !== 'OggS' || pageHeader[4] !== 0 || pageHeader[5]! & ~7) throw new RangeError('Invalid Ogg-FLAC metadata page.');
		const laces = await metadataBlobBytes(file, offset + 27, offset + 27 + pageHeader[26]!, signal);
		const bodyLength = laces.reduce((sum, value) => sum + value, 0);
		const page = await metadataBlobBytes(file, offset, offset + 27 + laces.length + bodyLength, signal);
		const pageView = new DataView(page.buffer);
		if (pageView.getUint32(14, true) !== serial || pageView.getUint32(18, true) !== sequence++
			|| Boolean(page[5]! & 1) !== (packetLength > 0) || pageView.getUint32(22, true) !== oggPageCrc(page)) {
			throw new RangeError('The Ogg-FLAC metadata page sequence or checksum is invalid.');
		}
		let start = 27 + laces.length, end = start;
		for (const length of laces) {
			end += length; packetLength += length; totalBytes += length;
			if (totalBytes > MAXIMUM_METADATA_BYTES) throw new RangeError('The Ogg-FLAC metadata exceeds its byte bound.');
			if (length === 255) continue;
			packetParts.push(page.subarray(start, end));
			const packet = metadataBytes(...packetParts);
			if (++blockCount > MAXIMUM_METADATA_BLOCKS || packet.length < 4 || (packet[0]! & 127) === 0
				|| (packet[0]! & 127) === 127 || packet.length !== 4 + packet[1]! * 65536 + packet[2]! * 256 + packet[3]!) {
				throw new RangeError('Invalid Ogg-FLAC metadata block.');
			}
			parts.push(packet); last = Boolean(packet[0]! & 128);
			packetParts = []; packetLength = 0; start = end;
			if (last) break;
		}
		if (!last && end > start) packetParts.push(page.subarray(start, end));
		offset += page.length;
	}
	if (declaredPackets && declaredPackets !== blockCount - 1) throw new RangeError('The Ogg-FLAC metadata packet count is inconsistent.');
	signal?.throwIfAborted();
	return new Blob(parts, { type: 'audio/flac' });
}

function ascii(bytes: Uint8Array): string { return String.fromCharCode(...bytes); }
