/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ReviewedImageFormat } from './image-format-signature.ts';

/** A static bitmap cannot verify the encoded PNG, GIF or WebP animation route. */
export function encodedImageIsAnimated(bytes: Uint8Array, format: ReviewedImageFormat): boolean {
	if (format === 'png') return animatedPng(bytes);
	if (format === 'webp') return animatedWebP(bytes);
	if (format === 'gif') return gifAnimation(bytes) !== null;
	return false;
}

/** Encoded timing for a PNG animation or a verified single-frame GIF loop. */
export function encodedImageAnimationInfo(bytes: Uint8Array, format: ReviewedImageFormat): Readonly<{
	frameCount: number; firstFrameDurationMicroseconds: number | null;
}> | null {
	if (format === 'gif') {
		const animation = gifAnimation(bytes);
		return animation && !animation.multipleFrames
			? { frameCount: 1, firstFrameDurationMicroseconds: animation.duration } : null;
	}
	if (format !== 'png') return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let frameCount: number | null = null;
	for (let offset = 8; offset + 12 <= bytes.byteLength;) {
		const length = view.getUint32(offset);
		if (offset + 12 + length > bytes.byteLength) return null;
		if (ascii(bytes, offset + 4, 'acTL') && length === 8) {
			frameCount = view.getUint32(offset + 8);
			if (frameCount === 0) return null;
		}
		if (frameCount !== null && ascii(bytes, offset + 4, 'fcTL') && length === 26) {
			const numerator = view.getUint16(offset + 28);
			const denominator = view.getUint16(offset + 30) || 100;
			return { frameCount, firstFrameDurationMicroseconds: numerator > 0
				? Math.round(numerator * 1_000_000 / denominator) : null };
		}
		offset += 12 + length;
	}
	return null;
}

function animatedPng(bytes: Uint8Array): boolean {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 8; offset + 12 <= bytes.byteLength;) {
		const length = view.getUint32(offset);
		if (offset + 12 + length > bytes.byteLength) return false;
		// Even one animation frame can differ from the default PNG poster and
		// carries its own timing, which a static bitmap cannot preserve.
		if (ascii(bytes, offset + 4, 'acTL') && length >= 8) return view.getUint32(offset + 8) > 0;
		offset += 12 + length;
	}
	return false;
}

function animatedWebP(bytes: Uint8Array): boolean {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const length = view.getUint32(offset + 4, true);
		if (offset + 8 + length > bytes.byteLength) return false;
		if (ascii(bytes, offset, 'ANIM') || (ascii(bytes, offset, 'VP8X')
			&& length >= 1 && (bytes[offset + 8]! & 2) !== 0)) return true;
		offset += 8 + length + (length & 1);
	}
	return false;
}

function gifAnimation(bytes: Uint8Array): { multipleFrames: true } | { multipleFrames: false; duration: number | null } | null {
	if (bytes.byteLength < 13) return null;
	let offset = 13 + tableBytes(bytes[10]!);
	let frames = 0;
	let looping = false;
	let pendingDelay: number | null = null, firstDelay: number | null = null;
	while (offset < bytes.byteLength) {
		const block = bytes[offset]!;
		if (block === 0x3b) return frames === 1 && looping ? { multipleFrames: false, duration: firstDelay } : null;
		if (block === 0x21) {
			const label = bytes[offset + 1], size = bytes[offset + 2];
			if (label === 0xf9 && size === 4 && bytes[offset + 7] === 0) {
				const hundredths = bytes[offset + 4]! | (bytes[offset + 5]! << 8);
				pendingDelay = hundredths > 0 ? hundredths * 10_000 : null;
			}
			if (label === 0x01) pendingDelay = null; // A plain-text graphic consumes its control extension.
			if (label === 0xff && size === 11 && bytes[offset + 14] === 3 && bytes[offset + 15] === 1
				&& bytes[offset + 18] === 0 && (ascii(bytes, offset + 3, 'NETSCAPE2.0') || ascii(bytes, offset + 3, 'ANIMEXTS1.0'))) looping = true;
			offset = skipSubBlocks(bytes, offset + 2);
		} else if (block === 0x2c) {
			if (offset + 10 > bytes.byteLength) return null;
			frames += 1;
			if (frames > 1) return { multipleFrames: true };
			firstDelay = pendingDelay;
			pendingDelay = null;
			offset = skipSubBlocks(bytes, offset + 11 + tableBytes(bytes[offset + 9]!));
		} else return null;
	}
	return null;
}

function tableBytes(packed: number): number {
	return (packed & 0x80) !== 0 ? 3 * 2 ** ((packed & 7) + 1) : 0;
}

function skipSubBlocks(bytes: Uint8Array, start: number): number {
	let offset = start;
	while (offset < bytes.byteLength) {
		const length = bytes[offset]!;
		offset += 1 + length;
		if (length === 0) return offset;
	}
	return bytes.byteLength;
}

function ascii(bytes: Uint8Array, offset: number, value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		if (bytes[offset + index] !== value.charCodeAt(index)) return false;
	}
	return true;
}
