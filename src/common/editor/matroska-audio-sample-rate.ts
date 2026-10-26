/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_HEADER_BYTES = 1024 * 1024;
const MAXIMUM_ELEMENTS = 4096;
interface Element { readonly id: number; readonly start: number; readonly end: number; readonly complete: boolean }

/** Opus always presents 48 kHz PCM; its optional input-rate field is not a decode clock. */
export function inspectMatroskaOpusSampleRate(input: Uint8Array): number | null {
	const bytes = input.subarray(0, MAXIMUM_HEADER_BYTES);
	if (bytes.length < 4 || new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) !== 0x1a45dfa3) return null;
	let elements = 0;
	function element(offset: number, limit: number): Element | null {
		if (++elements > MAXIMUM_ELEMENTS || offset >= limit) return null;
		const width = (first: number): number => { let width = 1; while (width <= 8 && !(first & (128 >>> (width - 1)))) width++; return width; };
		const idWidth = width(bytes[offset]!);
		if (idWidth > 4 || offset + idWidth >= limit) return null;
		let id = 0;
		for (let index = 0; index < idWidth; index++) id = id * 256 + bytes[offset + index]!;
		offset += idWidth;
		const sizeWidth = width(bytes[offset]!);
		if (sizeWidth > 8 || offset + sizeWidth > limit) return null;
		let size = bytes[offset]! & (255 >>> sizeWidth);
		let unknown = size === (255 >>> sizeWidth);
		for (let index = 1; index < sizeWidth; index++) {
			size = size * 256 + bytes[offset + index]!;
			unknown &&= bytes[offset + index] === 255;
		}
		const start = offset + sizeWidth;
		if (!unknown && (!Number.isSafeInteger(size) || !Number.isSafeInteger(start + size))) return null;
		return { id, start, end: unknown ? limit : Math.min(limit, start + size), complete: !unknown && start + size <= limit };
	}
	function unsigned(field: Element): number | null {
		if (field.end - field.start > 8) return null;
		let value = 0;
		for (let offset = field.start; offset < field.end; offset++) value = value * 256 + bytes[offset]!;
		return Number.isSafeInteger(value) ? value : null;
	}
	function tracks(start: number, end: number): number | null {
		let audioTracks = 0;
		for (let offset = start; offset < end;) {
			const entry = element(offset, end);
			if (!entry?.complete) return null;
			if (entry.id === 0xae) {
				let type: number | null = null, enabled: number | null = 1, codec: string | null = null;
				for (let position = entry.start; position < entry.end;) {
					const field = element(position, entry.end);
					if (!field?.complete) return null;
					if (field.id === 0x83) type = unsigned(field);
					else if (field.id === 0xb9) enabled = unsigned(field);
					else if (field.id === 0x86 && field.end - field.start <= 256) codec = String.fromCharCode(...bytes.subarray(field.start, field.end));
					position = field.end;
				}
				if (type === null || enabled === null) return null;
				if (type === 2 && enabled !== 0) {
					if (codec !== 'A_OPUS') return null;
					audioTracks++;
				}
			}
			offset = entry.end;
		}
		return audioTracks ? 48_000 : null;
	}
	for (let offset = 0; offset < bytes.length;) {
		const root = element(offset, bytes.length);
		if (!root) return null;
		if (root.id === 0x18538067) {
			for (let position = root.start; position < root.end;) {
				const child = element(position, root.end);
				if (!child?.complete) return null;
				if (child.id === 0x1654ae6b) return tracks(child.start, child.end);
				position = child.end;
			}
			return null;
		}
		if (!root.complete) return null;
		offset = root.end;
	}
	return null;
}
