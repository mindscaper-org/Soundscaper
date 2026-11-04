/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Bounded random access over a video Blob for the container timing demuxers.
 *
 * A timing probe only needs headers and per-frame index entries, which are tiny
 * beside the media they describe. Bounded read-ahead avoids a native I/O request
 * for every field; only requested header pages survive between scans. Logical
 * and physical byte ceilings still cap the work and resident read size.
 */

import { assertVideoTimingReadAuthority, videoTimingHeaderCache } from './video-timing-header-cache.ts';
import { raceAbortableRead } from '../foundation/abort-race.ts';

const READ_AHEAD_BYTES = 1024 * 1024;
const HEADER_PAGE_BYTES = 64;

/** Largest single ranged read a container walker may ask for: 64 MiB. */
export const VIDEO_TIMING_DEMUX_MAXIMUM_READ_BYTES = 64 * 1024 * 1024;

/** Largest number of bytes one probe may read in total: 256 MiB. */
export const VIDEO_TIMING_DEMUX_MAXIMUM_TOTAL_BYTES = 256 * 1024 * 1024;

export interface VideoTimingDemuxReader {
	/** Total size of the source in bytes. */
	readonly byteLength: number;
	/** Read exactly `length` bytes at `offset`, or throw if they are not there. */
	read(offset: number, length: number): Promise<Uint8Array>;
	/** Read up to `length` bytes at `offset`, stopping at the end of the source. */
	readAtMost(offset: number, length: number): Promise<Uint8Array>;
}

export interface VideoTimingDemuxReaderOptions {
	readonly signal?: AbortSignal;
	readonly maximumTotalBytes?: number;
}

class BlobTimingReader implements VideoTimingDemuxReader {
	readonly byteLength: number;

	readonly #blob: Blob;
	readonly #signal: AbortSignal | undefined;
	readonly #maximumTotalBytes: number;
	#totalBytes = 0;
	#physicalBytes = 0;
	#windowOffset = 0;
	#window = new Uint8Array(0);

	constructor(blob: Blob, options: VideoTimingDemuxReaderOptions) {
		this.#blob = blob;
		this.byteLength = blob.size;
		this.#signal = options.signal;
		this.#maximumTotalBytes = options.maximumTotalBytes ?? VIDEO_TIMING_DEMUX_MAXIMUM_TOTAL_BYTES;
	}

	async read(offset: number, length: number): Promise<Uint8Array> {
		const bytes = await this.readAtMost(offset, length);
		if (bytes.byteLength !== length) {
			throw new RangeError('The video container ended inside a structure it declared.');
		}
		return bytes;
	}

	async readAtMost(offset: number, length: number): Promise<Uint8Array> {
		throwIfAborted(this.#signal);
		assertVideoTimingReadAuthority(this.#blob);
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
			throw new RangeError('A video container read requires a non-negative safe range.');
		}
		if (length > VIDEO_TIMING_DEMUX_MAXIMUM_READ_BYTES) {
			throw new RangeError('A video container structure exceeds the bounded read size.');
		}
		if (offset >= this.byteLength || length === 0) return new Uint8Array(0);
		const end = Math.min(this.byteLength, offset + length);
		this.#totalBytes += end - offset;
		if (this.#totalBytes > this.#maximumTotalBytes) {
			throw new RangeError('Reading the video container exceeded the bounded timing-probe budget.');
		}
		const lengthRead = end - offset;
		const cache = videoTimingHeaderCache(this.#blob);
		const cached = cache?.read(offset, lengthRead);
		if (cached) return cached;
		if (cache && offset >= this.#windowOffset && end <= this.#windowOffset + this.#window.byteLength) {
			cache?.remember(offset, lengthRead, this.#windowOffset, this.#window);
			return this.#window.slice(offset - this.#windowOffset, end - this.#windowOffset);
		}
		let start = offset, readEnd = end;
		if (cache && lengthRead <= HEADER_PAGE_BYTES && this.#maximumTotalBytes >= READ_AHEAD_BYTES * 2) {
			start = Math.floor(offset / HEADER_PAGE_BYTES) * HEADER_PAGE_BYTES;
			const aheadEnd = Math.min(this.byteLength, start + READ_AHEAD_BYTES);
			// A large sparse source still needs headroom for index reads after read-ahead stops.
			const aheadBudget = this.byteLength <= this.#maximumTotalBytes
				? this.#maximumTotalBytes : Math.floor(this.#maximumTotalBytes * 7 / 8);
			readEnd = this.#physicalBytes + aheadEnd - start <= aheadBudget
				? aheadEnd : Math.min(this.byteLength, Math.ceil(end / HEADER_PAGE_BYTES) * HEADER_PAGE_BYTES);
		}
		this.#physicalBytes += readEnd - start;
		if (this.#physicalBytes > this.#maximumTotalBytes) {
			throw new RangeError('Reading the video container exceeded the bounded timing-probe budget.');
		}
		const buffer = await raceAbortableRead(() => this.#blob.slice(start, readEnd).arrayBuffer(), this.#signal);
		throwIfAborted(this.#signal);
		assertVideoTimingReadAuthority(this.#blob);
		const bytes = new Uint8Array(buffer);
		if (!cache || lengthRead > HEADER_PAGE_BYTES) return bytes;
		this.#windowOffset = start;
		this.#window = bytes;
		cache.remember(offset, lengthRead, start, bytes);
		return bytes.slice(offset - start, end - start);
	}
}

/** Wrap a Blob as the bounded reader the container walkers consume. */
export function createVideoTimingDemuxReader(
	blob: Blob,
	options: VideoTimingDemuxReaderOptions = {},
): VideoTimingDemuxReader {
	if (!(blob instanceof Blob)) throw new TypeError('A video Blob is required for timing demux.');
	return new BlobTimingReader(blob, options);
}

/** Read a big-endian unsigned integer of one to eight bytes. */
export function bigEndianUnsigned(bytes: Uint8Array, start: number, end: number): bigint {
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0
		|| end > bytes.byteLength || end - start < 0 || end - start > 8) {
		throw new RangeError('A container integer must span one to eight readable bytes.');
	}
	let value = 0n;
	for (let offset = start; offset < end; offset += 1) value = value << 8n | BigInt(bytes[offset]!);
	return value;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
