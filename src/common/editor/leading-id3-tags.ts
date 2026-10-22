/* SPDX-License-Identifier: AGPL-3.0-only */

export interface Id3PrefixByteSource {
	readonly size: number;
	slice(start: number, end: number): Readonly<{ arrayBuffer(): PromiseLike<ArrayBuffer> }>;
}

/** The MPEG demuxer admits consecutive ID3 tags; every geometry probe must seek
 * past the same prefix without retaining lyrics, padding or artwork payloads.
 */
export async function leadingId3AudioOffset(file: Id3PrefixByteSource, prefix?: Uint8Array, signal?: AbortSignal): Promise<number | null> {
	let offset = 0;
	for (let tags = 0; tags < 4096; tags++) {
		signal?.throwIfAborted();
		const header = prefix && offset + 10 <= prefix.length ? prefix.subarray(offset, offset + 10)
			: new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 10)).arrayBuffer());
		signal?.throwIfAborted();
		if (String.fromCharCode(...header.subarray(0, 3)) !== 'ID3') return offset;
		if (header.length !== 10 || header.subarray(6, 10).some(byte => byte > 127)) return null;
		const size = (header[6]! << 21) | (header[7]! << 14) | (header[8]! << 7) | header[9]!;
		offset += 10 + size + (header[5]! & 16 ? 10 : 0);
		if (!Number.isSafeInteger(offset) || offset > file.size) return null;
	}
	return null;
}
