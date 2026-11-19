/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ReviewedImageFormat } from '../imaging/image-format-signature.ts';
import { IMAGE_IMPORT_LIMITS } from '../imaging/image-import-admission.ts';

/** Inspect encoded metadata before granting the verified plain sRGB decode route. */
export function assertBrowserNativeImageMetadata(bytes: Uint8Array, format: ReviewedImageFormat): void {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let metadataBytes = 0;
	let iccBytes = 0;
	let unsupportedColor = false;
	const metadata = (length: number): void => {
		metadataBytes += length;
		if (metadataBytes > IMAGE_IMPORT_LIMITS.maximumMetadataBytesPerFile) {
			throw new RangeError('Image metadata exceeds the 8 MiB per-file limit.');
		}
	};
	const profile = (length: number): void => {
		iccBytes += length;
		unsupportedColor = true;
		if (iccBytes > IMAGE_IMPORT_LIMITS.maximumIccBytesPerFile) {
			throw new RangeError('Image ICC data exceeds the 4 MiB per-file limit.');
		}
	};
	if (format === 'png') {
		for (let offset = 8; offset + 12 <= bytes.length;) {
			const length = view.getUint32(offset), body = offset + 8;
			if (offset + length + 12 > bytes.length) break;
			const type = ascii(bytes, offset + 4, 4);
			if (type !== 'IDAT' && type !== 'fdAT') metadata(length);
			if (type === 'iCCP') profile(length);
			if (type === 'cICP') unsupportedColor ||= length !== 4 || bytes[body] !== 1
				|| bytes[body + 1] !== 13 || bytes[body + 2] !== 0 || bytes[body + 3] !== 1;
			if (type === 'gAMA') unsupportedColor ||= length !== 4 || view.getUint32(body) !== 45_455;
			if (type === 'cHRM') {
				const srgb = [31_270, 32_900, 64_000, 33_000, 30_000, 60_000, 15_000, 6_000];
				unsupportedColor ||= length !== 32 || srgb.some((value, index) => view.getUint32(body + index * 4) !== value);
			}
			offset += length + 12;
		}
	} else if (format === 'jpeg') {
		for (let offset = 2; offset + 1 < bytes.length;) {
			if (bytes[offset] !== 0xff) { offset += 1; continue; }
			while (bytes[offset] === 0xff) offset += 1;
			const marker = bytes[offset++];
			if (marker === undefined || marker === 0xd9) break;
			if (marker === 0 || marker === 1 || marker >= 0xd0 && marker <= 0xd8) continue;
			if (offset + 2 > bytes.length) break;
			const length = view.getUint16(offset);
			if (length < 2 || offset + length > bytes.length) break;
			if (marker >= 0xe0 && marker <= 0xef || marker === 0xfe) metadata(length - 2);
			if (marker === 0xe2 && ascii(bytes, offset + 2, 12) === 'ICC_PROFILE\0') profile(length - 2);
			offset += length;
		}
	} else if (format === 'webp') {
		for (let offset = 12; offset + 8 <= bytes.length;) {
			const length = view.getUint32(offset + 4, true);
			if (offset + 8 + length > bytes.length) break;
			const type = ascii(bytes, offset, 4);
			if (type === 'ICCP' || type === 'EXIF' || type === 'XMP ') metadata(length);
			if (type === 'ICCP') profile(length);
			offset += length + 8 + (length & 1);
		}
	} else if (format === 'gif' && bytes.length >= 13) {
		let offset = 13 + gifTableBytes(bytes[10]!);
		while (offset < bytes.length) {
			const block = bytes[offset++];
			if (block === 0x3b) break;
			if (block === 0x21) {
				offset += 1;
				while (offset < bytes.length) {
					const length = bytes[offset++]!;
					if (offset + length > bytes.length) break;
					metadata(length); offset += length;
					if (length === 0) break;
				}
			} else if (block === 0x2c && offset + 9 <= bytes.length) {
				offset += 9 + gifTableBytes(bytes[offset + 8]!) + 1;
				while (offset < bytes.length) {
					const length = bytes[offset++]!; offset += length;
					if (length === 0) break;
				}
			} else break;
		}
	} else if (format === 'bmp' && bytes.length >= 122 && view.getUint32(14, true) >= 108) {
		const colorSpace = view.getUint32(14 + 56, true);
		// LCS_sRGB and LCS_WINDOWS_COLOR_SPACE both describe sRGB pixels.
		unsupportedColor ||= colorSpace !== 0x73524742 && colorSpace !== 0x57696e20;
		if (bytes.length >= 138 && view.getUint32(14, true) >= 124) {
			const length = view.getUint32(14 + 116, true);
			if (length) { metadata(length); profile(length); }
		}
	}
	if (unsupportedColor) {
		throw new RangeError('Embedded ICC or non-sRGB image color requires a verified color normalization route.');
	}
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function gifTableBytes(packed: number): number {
	return packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0;
}
