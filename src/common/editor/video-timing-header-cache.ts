/* SPDX-License-Identifier: AGPL-3.0-only */

const PAGE_BYTES = 64;
const MAXIMUM_PAGES = 32_768;
const MAXIMUM_OWNERS = 4;
const caches = new WeakMap<Blob, VideoTimingHeaderCache>();
const recent = new Set<VideoTimingHeaderCache>();
const authorities = new WeakMap<Blob, () => void>();

/** A pathless desktop selection can cache only while its original read grant remains live. */
export function registerVideoTimingReadAuthority(blob: Blob, assertReadable: () => void): void {
	if (authorities.has(blob)) throw new Error('A video read authority is already registered.');
	authorities.set(blob, assertReadable);
}

export function assertVideoTimingReadAuthority(blob: Blob): void { authorities.get(blob)?.(); }

/** Only immutable native bodies can share read results across independent scans. */
export function videoTimingHeaderCache(blob: Blob): VideoTimingHeaderCache | null {
	const prototype: unknown = Object.getPrototypeOf(blob);
	if (!authorities.has(blob) && ((prototype !== Blob.prototype && (typeof File === 'undefined' || prototype !== File.prototype))
		|| ['slice', 'arrayBuffer', 'size'].some(key => Object.hasOwn(blob, key)))) return null;
	let cache = caches.get(blob);
	if (!cache) { cache = new VideoTimingHeaderCache(); caches.set(blob, cache); }
	touch(cache);
	return cache;
}

function touch(cache: VideoTimingHeaderCache): void {
	recent.delete(cache);
	recent.add(cache);
	while (recent.size > MAXIMUM_OWNERS) {
		const oldest = recent.values().next().value!;
		oldest.clear();
		recent.delete(oldest);
	}
}

/** At most 2 MiB of copied header pages per owner; encoded read-ahead is never retained here. */
class VideoTimingHeaderCache {
	readonly #pages = new Map<number, Uint8Array>();
	clear(): void { this.#pages.clear(); }
	read(offset: number, length: number): Uint8Array | null {
		if (length > PAGE_BYTES) return null;
		touch(this);
		const output = new Uint8Array(length);
		for (let position = offset; position < offset + length;) {
			const start = Math.floor(position / PAGE_BYTES) * PAGE_BYTES;
			const page = this.#pages.get(start);
			if (!page || position - start >= page.byteLength) return null;
			const count = Math.min(offset + length - position, page.byteLength - (position - start));
			output.set(page.subarray(position - start, position - start + count), position - offset);
			position += count;
		}
		return output;
	}
	remember(offset: number, length: number, windowOffset: number, bytes: Uint8Array): void {
		if (length > PAGE_BYTES) return;
		touch(this);
		for (let start = Math.floor(offset / PAGE_BYTES) * PAGE_BYTES; start < offset + length; start += PAGE_BYTES) {
			if (start < windowOffset) continue;
			const page = bytes.slice(start - windowOffset, start - windowOffset + PAGE_BYTES);
			if (!page.byteLength) continue;
			this.#pages.delete(start);
			this.#pages.set(start, page);
		}
		while (this.#pages.size > MAXIMUM_PAGES) this.#pages.delete(this.#pages.keys().next().value!);
	}
}
