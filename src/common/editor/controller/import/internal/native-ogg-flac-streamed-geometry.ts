/* SPDX-License-Identifier: AGPL-3.0-only */

import { oggPageCrc } from '../../../ogg-page-crc.ts';
import { raceAbortableRead } from '../../../../foundation/abort-race.ts';

const MAX_PAGES = 65_536;
const UNKNOWN_GRANULE = 0xffff_ffff_ffff_ffffn;
const SAMPLE_RATES = [0, 88_200, 176_400, 192_000, 8000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 96_000];

interface FlacGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly maximumFrames: number;
}

type PendingPacket = Readonly<{
	readonly frameCount: number;
	readonly metadataBytes: number;
	readonly lastMetadata: boolean;
}>;

/** RFC 9639 sections 9 and 10.1. Bound native allocation by the frames in
 * the physical audio packets and qualify the container's final sample count. */
export async function streamedOggFlacFrameCount(file: Blob, identification: Uint8Array<ArrayBuffer>,
	geometry: FlacGeometry, signal?: AbortSignal): Promise<number> {
	const streamInfo = new DataView(identification.buffer);
	const serial = streamInfo.getUint32(14, true);
	const maximumBlock = streamInfo.getUint16(47);
	if (streamInfo.getBigUint64(6, true) !== 0n || maximumBlock < 16) return 0;
	let metadata = !(identification[41]! & 128);
	let packet: PendingPacket | null = null, packetBytes = 0, frames = 0, packets = 0;
	let offset = identification.length;
	for (let sequence = 1; offset < file.size && sequence <= MAX_PAGES; sequence++) {
		const page = await readPage(file, offset, signal);
		if (!page) return 0;
		const flags = page[5]!, view = new DataView(page.buffer, page.byteOffset, page.byteLength);
		if (flags & ~5 || Boolean(flags & 1) !== (packet !== null)
			|| view.getUint32(14, true) !== serial || view.getUint32(18, true) !== sequence
			|| view.getUint32(22, true) !== oggPageCrc(page)) return 0;
		const headerPage = metadata;
		const laces = page.subarray(27, 27 + page[26]!);
		let body = 27 + laces.length, completedFrames = false;
		for (const length of laces) {
			if (!packet) {
				if (headerPage && !metadata) return 0;
				packet = describePacket(page.subarray(body, body + length), geometry, metadata, frames, packets);
				if (!packet || packet.frameCount > maximumBlock) return 0;
			}
			body += length; packetBytes += length;
			if (length === 255) continue;
			if (metadata) {
				if (packetBytes !== packet.metadataBytes) return 0;
				metadata = !packet.lastMetadata;
			} else {
				completedFrames = true; packets++;
				frames += packet.frameCount;
				if (frames > geometry.maximumFrames) return 0;
			}
			packet = null; packetBytes = 0;
		}
		offset += page.length;
		const granule = view.getBigUint64(6, true);
		if (granule !== (headerPage ? 0n : completedFrames ? BigInt(frames) : UNKNOWN_GRANULE)) return 0;
		if (flags & 4) return !metadata && !packet && completedFrames && offset === file.size ? frames : 0;
	}
	return 0;
}

async function readPage(file: Blob, offset: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
	const prefix = new Uint8Array(await raceAbortableRead(() => file.slice(offset, offset + 282).arrayBuffer(), signal));
	if (prefix.length < 27 || prefix[0] !== 0x4f || prefix[1] !== 0x67 || prefix[2] !== 0x67 || prefix[3] !== 0x53
		|| prefix[4] !== 0 || !prefix[26] || prefix.length < 27 + prefix[26]) return null;
	const bodyOffset = 27 + prefix[26];
	const size = bodyOffset + prefix.subarray(27, bodyOffset).reduce((sum, length) => sum + length, 0);
	if (size > file.size - offset) return null;
	return size <= prefix.length ? prefix.subarray(0, size)
		: new Uint8Array(await raceAbortableRead(() => file.slice(offset, offset + size).arrayBuffer(), signal));
}

function describePacket(bytes: Uint8Array, geometry: FlacGeometry, metadata: boolean, frames: number, packets: number): PendingPacket | null {
	if (metadata) {
		if (bytes.length < 4 || (bytes[0]! & 127) === 0 || (bytes[0]! & 127) === 127) return null;
		return { frameCount: 0, metadataBytes: 4 + bytes[1]! * 65_536 + bytes[2]! * 256 + bytes[3]!, lastMetadata: Boolean(bytes[0]! & 128) };
	}
	const frameCount = flacFrameBlockSize(bytes, geometry, frames, packets);
	return frameCount ? { frameCount, metadataBytes: 0, lastMetadata: false } : null;
}

function flacFrameBlockSize(bytes: Uint8Array, geometry: FlacGeometry, frames: number, packets: number): number {
	if (bytes.length < 6 || bytes[0] !== 0xff || (bytes[1]! & 0xfe) !== 0xf8 || bytes[3]! & 1) return 0;
	const assignment = bytes[3]! >> 4;
	if ((assignment < 8 ? assignment + 1 : assignment <= 10 ? 2 : 0) !== geometry.channelCount) return 0;
	const first = bytes[4]!;
	let leading = 0;
	for (let flag = 128; first & flag; flag >>= 1) leading++;
	if (leading === 1 || leading > 7 || bytes.length <= 4 + leading) return 0;
	let number = leading ? first & (127 >> leading) : first;
	let offset = 4 + Math.max(1, leading);
	for (let index = 5; index < offset; index++) {
		if ((bytes[index]! & 0xc0) !== 0x80) return 0;
		number = number * 64 + (bytes[index]! & 63);
	}
	if (number !== (bytes[1]! & 1 ? frames : packets)) return 0;
	const blockCode = bytes[2]! >> 4, rateCode = bytes[2]! & 15;
	if (!blockCode || rateCode === 15) return 0;
	let blockSize: number;
	if (blockCode === 6 || blockCode === 7) {
		if (bytes.length <= offset + blockCode - 6) return 0;
		blockSize = (blockCode === 6 ? bytes[offset++]! : bytes[offset++]! * 256 + bytes[offset++]!) + 1;
	} else blockSize = blockCode === 1 ? 192 : blockCode < 6 ? 144 * 2 ** blockCode : 2 ** blockCode;
	const rate = frameSampleRate(bytes, rateCode, offset, geometry.sampleRate);
	return rate === geometry.sampleRate ? blockSize : 0;
}

function frameSampleRate(bytes: Uint8Array, code: number, offset: number, streamRate: number): number {
	if (code < 12) return SAMPLE_RATES[code] || streamRate;
	if (code === 12) return (bytes[offset] ?? 0) * 1000;
	const value = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
	return code === 13 ? value : value * 10;
}
