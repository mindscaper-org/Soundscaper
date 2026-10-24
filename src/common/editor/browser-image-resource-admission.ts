/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ReviewedImageFormat } from './image-format-signature.ts';
import { admitImageDecodeWorkload } from './image-import-admission.ts';

interface EncodedCanvas {
	readonly width: number;
	readonly height: number;
}

/**
 * Refuse a known excessive encoded canvas before native raster allocation.
 * This is only a lower-bound resource check: the decoder still owns validity,
 * orientation, topology and the authoritative output dimensions. Rotation can
 * exchange the sides, but preserves both the pixel count and largest side.
 */
export function assertBrowserNativeImageResources(
	bytes: Uint8Array,
	format: ReviewedImageFormat,
	frameCount = 1,
): void {
	const canvas = encodedCanvas(bytes, format);
	if (!canvas) return;
	admitImageDecodeWorkload({
		sourceByteLength: bytes.byteLength, ...canvas, precision: 'sdr', frameCount,
		durationMicroseconds: 1, iccBytes: 0, metadataBytes: 0,
	}, {
		// The import owner separately handles input-size warnings and admission.
		maximumFileInputBytes: bytes.byteLength,
	});
}

function encodedCanvas(bytes: Uint8Array, format: ReviewedImageFormat): EncodedCanvas | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (format === 'png' && bytes.byteLength >= 33
		&& view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
		return positiveCanvas(view.getUint32(16), view.getUint32(20));
	}
	if (format === 'gif' && bytes.byteLength >= 13 && ascii(bytes, 0, 'GIF')) {
		return positiveCanvas(view.getUint16(6, true), view.getUint16(8, true));
	}
	if (format === 'bmp' && bytes.byteLength >= 26 && ascii(bytes, 0, 'BM')) {
		const size = view.getUint32(14, true);
		if (size === 12) return positiveCanvas(view.getUint16(18, true), view.getUint16(20, true));
		if (size >= 16 && 14 + size <= bytes.byteLength) {
			return positiveCanvas(view.getInt32(18, true), Math.abs(view.getInt32(22, true)));
		}
	}
	if (format === 'jpeg') return jpegCanvas(bytes, view);
	if (format === 'webp') return webpCanvas(bytes, view);
	return null;
}

// ITU-T T.81 B.2.2 frame headers; segment extents are checked before every read.
function jpegCanvas(bytes: Uint8Array, view: DataView): EncodedCanvas | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 1 < bytes.byteLength) {
		if (bytes[offset] !== 0xff) return null;
		while (bytes[offset] === 0xff) offset += 1;
		const marker = bytes[offset++];
		if (marker === undefined || marker === 0xda || marker === 0xd9 || marker === 0) return null;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
		if (offset + 2 > bytes.byteLength) return null;
		const length = view.getUint16(offset);
		if (length < 2 || offset + length > bytes.byteLength) return null;
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			return length >= 8 ? positiveCanvas(view.getUint16(offset + 5), view.getUint16(offset + 3)) : null;
		}
		offset += length;
	}
	return null;
}

// https://developers.google.com/speed/webp/docs/riff_container
function webpCanvas(bytes: Uint8Array, view: DataView): EncodedCanvas | null {
	if (bytes.byteLength < 20 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return null;
	const length = view.getUint32(16, true);
	if (length + 20 > bytes.byteLength) return null;
	if (ascii(bytes, 12, 'VP8X') && length >= 10) {
		return positiveCanvas(uint24(bytes, 24) + 1, uint24(bytes, 27) + 1);
	}
	if (ascii(bytes, 12, 'VP8L') && length >= 5 && bytes[20] === 0x2f) {
		const packed = view.getUint32(21, true);
		return positiveCanvas((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
	}
	if (ascii(bytes, 12, 'VP8 ') && length >= 10
		&& bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
		return positiveCanvas(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
	}
	return null;
}

function positiveCanvas(width: number, height: number): EncodedCanvas | null {
	return width > 0 && height > 0 ? { width, height } : null;
}

function uint24(bytes: Uint8Array, offset: number): number {
	return bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65_536;
}

function ascii(bytes: Uint8Array, offset: number, value: string): boolean {
	return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}
