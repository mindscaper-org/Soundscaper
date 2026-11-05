/* SPDX-License-Identifier: AGPL-3.0-only */

import { leadingApeTagEnd } from './ape-tag-location.ts';
import type { MetadataByteSource } from './audio-metadata-values.ts';

interface ChannelRoles { info: boolean; identities: boolean }

/** Original carries a channel count; custom WavPack speaker roles cannot be replayed. */
export async function readOriginalWavPackHeader(file: MetadataByteSource, prefix: Uint8Array, channels: number): Promise<Uint8Array | null> {
	if (channels !== 1 && channels !== 2) return null;
	const read = async (start: number, length: number): Promise<Uint8Array> => {
		if (start + length > file.size) throw new RangeError('Truncated WavPack source.');
		if (start + length <= prefix.length) return prefix.subarray(start, start + length);
		const bytes = new Uint8Array(await file.slice(start, start + length).arrayBuffer());
		if (bytes.length !== length) throw new RangeError('Truncated WavPack source.');
		return bytes;
	};
	let offset = await leadingApeTagEnd(file);
	let audio: Uint8Array | null = null;
	const roles: ChannelRoles = { info: false, identities: false };
	for (let block = 0; block < 1_000_000; block++) {
		const header = await read(offset, 32);
		if (String.fromCharCode(...header.subarray(0, 4)) !== 'wvpk') return null;
		const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
		const size = view.getUint32(4, true) + 8;
		if (size < 32 || size > 4 * 1024 ** 2 || offset + size > file.size) return null;
		if (!await compatibleMetadata(read, offset + 32, offset + size, channels, roles)) return null;
		if (view.getUint32(20, true) > 0) {
			audio ??= header;
			// A two-channel file can store the first segment in two mono blocks.
			if (view.getUint32(24, true) & 0x1000) return audio;
		}
		offset += size;
	}
	return null;
}

/** Seek across wrapper/entropy payloads; only tiny channel-role metadata is read. */
async function compatibleMetadata(
	read: (start: number, length: number) => Promise<Uint8Array>, start: number, end: number,
	channels: number, roles: ChannelRoles,
): Promise<boolean> {
	let offset = start, count = 0;
	while (offset < end) {
		if (++count > 4096 || offset + 2 > end) return false;
		const header = await read(offset, 2);
		const rawId = header[0]!;
		let words = header[1]!;
		offset += 2;
		if (rawId & 0x80) {
			if (offset + 2 > end) return false;
			const high = await read(offset, 2);
			words += high[0]! * 256 + high[1]! * 65_536;
			offset += 2;
		}
		const stored = words * 2, length = stored - (rawId & 0x40 ? 1 : 0);
		if (length < 0 || offset + stored > end) return false;
		const id = rawId & 0x3f;
		if (id === 0x0d && !roles.info) {
			if (length < 1 || length > 7 || !compatibleChannelInfo(await read(offset, length), channels)) return false;
			roles.info = true;
		} else if (id === 0x2b && !roles.identities) {
			// Non-Microsoft roles use explicit identities; 0xff means undefined.
			if (length < 1 || length > channels || !(await read(offset, length)).every(value => value === 0xff)) return false;
			roles.identities = true;
		}
		offset += stored;
	}
	return true;
}

/** Match the pinned reference decoder's short and unlimited-stream encodings. */
function compatibleChannelInfo(bytes: Uint8Array, channels: number): boolean {
	const extended = bytes.length >= 6;
	const count = extended ? (bytes[0]! | (bytes[2]! & 0x0f) << 8) + 1 : bytes[0]!;
	if (count !== channels) return false;
	let mask = 0;
	for (let index = bytes.length - 1; index >= (extended ? 3 : 1); index--) mask = mask * 256 + bytes[index]!;
	return mask === 0 || mask === (channels === 1 ? 4 : 3);
}
