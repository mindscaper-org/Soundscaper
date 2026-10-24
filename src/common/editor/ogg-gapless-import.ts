/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectOpusInitialGranule } from './opus-initial-granule.ts';
import { inspectVorbisAbsoluteOrigin, type VorbisPacketGeometry } from './vorbis-initial-granule.ts';

export interface OggGaplessGeometry {
	readonly sampleRate: number;
	readonly sourceFrames: number;
}

const MAXIMUM_PAGE_BYTES = 65_307;
const MAXIMUM_SCAN_PAGES = 1_000_000;

/** The final Ogg granule, rather than the full last codec packet, ends the source. */
export async function inspectOggGaplessGeometry(file: Blob, codec: 'opus' | 'vorbis', signal?: AbortSignal,
	vorbisPackets?: AsyncIterable<VorbisPacketGeometry>): Promise<OggGaplessGeometry | null> {
	signal?.throwIfAborted();
	const first = await findAudioIdentificationPage(file, codec);
	signal?.throwIfAborted();
	if (!first) return null;
	verifyPageChecksum(first);
	const body = first.subarray(27 + first[26]!);
	let preSkip = 0;
	let sampleRate = 48_000;
	if (codec === 'opus') {
		if (body.length < 19 || ascii(body, 0, 8) !== 'OpusHead') return null;
		preSkip = body[10]! | (body[11]! << 8);
	} else {
		if (body.length < 30 || body[0] !== 1 || ascii(body, 1, 6) !== 'vorbis') return null;
		sampleRate = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(12, true);
	}
	const serial = new DataView(first.buffer).getUint32(14, true);
	const origin = codec === 'opus' ? await inspectOpusInitialGranule(file, serial, signal)
		: vorbisPackets ? await inspectVorbisAbsoluteOrigin(file, serial, sampleRate, vorbisPackets, signal) : 0;
	const tail = new Uint8Array(await file.slice(Math.max(0, file.size - MAXIMUM_PAGE_BYTES * 2)).arrayBuffer());
	signal?.throwIfAborted();
	for (let offset = tail.length - 27; offset >= 0; offset -= 1) {
		if (ascii(tail, offset, 4) !== 'OggS' || tail[offset + 4] || !(tail[offset + 5]! & 4)) continue;
		const size = pageSize(tail, offset);
		if (!size) continue;
		const view = new DataView(tail.buffer, tail.byteOffset + offset, size);
		if (view.getUint32(14, true) !== serial) continue;
		const geometry = endPageGeometry(tail.subarray(offset, offset + size), preSkip, sampleRate, origin);
		await rejectChainedAudio(file, file.size - tail.length + offset + size, signal);
		return geometry;
	}
	// A secondary logical stream can continue long after the primary audio ends.
	// Follow physical page headers without reading intervening encoded payloads.
	const end = await findEarlierEndPage(file, serial, signal);
	if (end) {
		const geometry = endPageGeometry(end.page, preSkip, sampleRate, origin);
		await rejectChainedAudio(file, end.endOffset, signal);
		return geometry;
	}
	throw new Error('The Ogg audio source has no final granule for its primary stream.');
}

function endPageGeometry(page: Uint8Array, preSkip: number, sampleRate: number, origin: number): OggGaplessGeometry {
	verifyPageChecksum(page);
	const granule = new DataView(page.buffer, page.byteOffset, page.byteLength).getBigUint64(6, true);
	if (granule > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The Ogg source granule exceeds the safe range.');
	const sourceFrames = Number(granule) - origin - preSkip;
	if (sourceFrames < 1 || sampleRate < 1) throw new Error('The Ogg source declares empty gapless geometry.');
	return Object.freeze({ sampleRate, sourceFrames });
}

async function findEarlierEndPage(file: Blob, serial: number, signal?: AbortSignal): Promise<Readonly<{ page: Uint8Array; endOffset: number }> | null> {
	let offset = 0;
	for (let count = 0; offset < file.size; count++) {
		signal?.throwIfAborted();
		if (count >= MAXIMUM_SCAN_PAGES) throw new RangeError('The Ogg source exceeds its bounded page inspection count.');
		const header = new Uint8Array(await file.slice(offset, offset + 27).arrayBuffer());
		if (header.length !== 27 || ascii(header, 0, 4) !== 'OggS' || header[4] || header[5]! & ~7) return null;
		const laces = new Uint8Array(await file.slice(offset + 27, offset + 27 + header[26]!).arrayBuffer());
		if (laces.length !== header[26]) return null;
		const size = 27 + laces.length + laces.reduce((sum, length) => sum + length, 0);
		if (size > file.size - offset) return null;
		if (header[5]! & 4 && new DataView(header.buffer).getUint32(14, true) === serial) {
			const page = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
			signal?.throwIfAborted();
			return { page, endOffset: offset + size };
		}
		offset += size;
	}
	signal?.throwIfAborted();
	return null;
}

/** The maintained decoder selects a track from the first link, not a full chain. */
async function rejectChainedAudio(file: Blob, start: number, signal?: AbortSignal): Promise<void> {
	for (let offset = start, count = 0; offset < file.size; count++) {
		signal?.throwIfAborted();
		if (count >= MAXIMUM_SCAN_PAGES) throw new RangeError('The Ogg source exceeds its bounded page inspection count.');
		const header = new Uint8Array(await file.slice(offset, offset + 27).arrayBuffer());
		if (header.length !== 27 || ascii(header, 0, 4) !== 'OggS' || header[4] || header[5]! & ~7) return;
		const laces = new Uint8Array(await file.slice(offset + 27, offset + 27 + header[26]!).arrayBuffer());
		if (laces.length !== header[26]) return;
		const bodyBytes = laces.reduce((sum, length) => sum + length, 0);
		const size = 27 + laces.length + bodyBytes;
		if (size > file.size - offset) return;
		if ((header[5]! & 3) === 2 && bodyBytes >= 8) {
			const body = new Uint8Array(await file.slice(offset + 27 + laces.length, offset + 35 + laces.length).arrayBuffer());
			if (ascii(body, 0, 8) === 'OpusHead' || body[0] === 1 && ascii(body, 1, 6) === 'vorbis') {
				const page = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
				signal?.throwIfAborted();
				verifyPageChecksum(page);
				throw new Error('This Ogg file contains chained audio recordings. Split it into individual recordings before importing to avoid losing later audio.');
			}
		}
		offset += size;
	}
	signal?.throwIfAborted();
}

export async function findAudioIdentificationPage(file: Blob, codec: 'opus' | 'vorbis'): Promise<Uint8Array<ArrayBuffer> | null> {
	// All logical-stream BOS pages precede data pages. Skeleton and other auxiliary
	// streams may precede the primary audio; their serial and granules do not own it.
	for (let offset = 0; offset < Math.min(file.size, 1024 * 1024);) {
		const page = new Uint8Array(await file.slice(offset, offset + MAXIMUM_PAGE_BYTES).arrayBuffer());
		if (page.length < 27 || ascii(page, 0, 4) !== 'OggS' || page[4] || (page[5]! & 3) !== 2) return null;
		const size = pageSize(page, 0);
		if (!size) return null;
		const body = page.subarray(27 + page[26]!, size);
		if (codec === 'opus' ? ascii(body, 0, 8) === 'OpusHead' : body[0] === 1 && ascii(body, 1, 6) === 'vorbis') {
			return page.slice(0, size);
		}
		offset += size;
	}
	return null;
}

function pageSize(bytes: Uint8Array, offset: number): number {
	const segments = bytes[offset + 26]!;
	if (offset + 27 + segments > bytes.length) return 0;
	let size = 27 + segments;
	for (let index = 0; index < segments; index += 1) size += bytes[offset + 27 + index]!;
	return offset + size <= bytes.length ? size : 0;
}

function verifyPageChecksum(page: Uint8Array): void {
	let checksum = 0;
	for (let index = 0; index < page.length; index += 1) {
		checksum ^= (index >= 22 && index < 26 ? 0 : page[index]!) << 24;
		for (let bit = 0; bit < 8; bit += 1) checksum = (checksum << 1) ^ (checksum & 0x8000_0000 ? 0x04c1_1db7 : 0);
	}
	if ((checksum >>> 0) !== new DataView(page.buffer, page.byteOffset, page.byteLength).getUint32(22, true)) {
		throw new Error('The Ogg source page checksum failed.');
	}
}

function ascii(bytes: Uint8Array, offset: number, count: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + count));
}
