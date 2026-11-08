/* SPDX-License-Identifier: AGPL-3.0-only */
import { leadingId3AudioOffset, type Id3PrefixByteSource } from './leading-id3-tags.ts';

/** The admitted FLAC reader accepts consecutive tags; seek to the same STREAMINFO. */
export async function readOriginalFlacHeader(file: Id3PrefixByteSource, prefix: Uint8Array): Promise<Uint8Array | null> {
	const offset = await leadingId3AudioOffset(file, prefix);
	if (offset === null || offset + 42 > file.size) return null;
	const header = offset + 42 <= prefix.length ? prefix.subarray(offset, offset + 42)
		: new Uint8Array(await file.slice(offset, offset + 42).arrayBuffer());
	if (header.length !== 42 || header[0] !== 102 || header[1] !== 76 || header[2] !== 97 || header[3] !== 67
		|| (header[4]! & 127) !== 0 || header[5] !== 0 || header[6] !== 0 || header[7] !== 34) return null;
	return header;
}
