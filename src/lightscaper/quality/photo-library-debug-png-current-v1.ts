/* SPDX-License-Identifier: AGPL-3.0-only */
import { unzlibSync } from 'fflate';
import { debugHashCurrentV1 } from './photo-library-debug-bytes-current-v1.ts';
const MAXIMUM = 8 * 1024 * 1024;
/** Independent readback of this diagnostic's fixed RGBA8/filter0 PNG export.
 * It receives actual committed File bytes, never the encoder's return buffer. */
export function readDebugPngCurrentV1(bytes: Uint8Array<ArrayBuffer>): Readonly<{ width: number; height: number; pixelsSha256: string }> {
	if (bytes.length < 57 || bytes.length > MAXIMUM || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, at) => bytes[at] === value)) throw new TypeError('Diagnostic output is not a bounded PNG.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks: Uint8Array<ArrayBuffer>[] = [];
	let at = 8, width = 0, height = 0, compressed = 0, ended = false;
	while (at < bytes.length) {
		if (bytes.length - at < 12) throw new TypeError('Diagnostic PNG chunk is truncated.');
		const size = view.getUint32(at); if (size > bytes.length - at - 12) throw new TypeError('Diagnostic PNG chunk exceeds the File.');
		const start = at + 4, body = at + 8, end = body + size, name = String.fromCharCode(...bytes.subarray(start, body));
		if (crc(bytes.subarray(start, end)) !== view.getUint32(end)) throw new TypeError('Diagnostic PNG readback CRC differs.');
		if (name === 'IHDR') {
			if (at !== 8 || size !== 13 || width !== 0) throw new TypeError('Diagnostic PNG header is malformed.');
			width = view.getUint32(body); height = view.getUint32(body + 4);
			if (!width || !height || width * height > 1_048_576 || bytes[body + 8] !== 8 || bytes[body + 9] !== 6 || bytes[body + 10] !== 0 || bytes[body + 11] !== 0 || bytes[body + 12] !== 0) throw new RangeError('Diagnostic PNG must be tiny noninterlaced RGBA8.');
		} else if (name === 'IDAT') { if (!width || ended) throw new TypeError('Diagnostic PNG data order differs.'); chunks.push(bytes.subarray(body, end)); compressed += size; }
		else if (name === 'IEND') { if (size !== 0 || end + 4 !== bytes.length) throw new TypeError('Diagnostic PNG end differs.'); ended = true; }
		else if (name !== 'sRGB') throw new TypeError('Diagnostic PNG contains an unexpected chunk.');
		at = end + 4;
	}
	if (!ended || !compressed) throw new TypeError('Diagnostic PNG lacks its data/end.');
	const joined = new Uint8Array(compressed), expected = height * (width * 4 + 1), inflated = new Uint8Array(expected), pixels = new Uint8Array(width * height * 4);
	try {
		let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
		const decoded = unzlibSync(joined, { out: inflated }); if (decoded.byteLength !== expected) throw new TypeError('Diagnostic PNG scanline length differs.');
		for (let row = 0; row < height; row++) { const start = row * (width * 4 + 1); if (decoded[start] !== 0) throw new TypeError('Diagnostic PNG uses an unexpected scanline filter.'); pixels.set(decoded.subarray(start + 1, start + 1 + width * 4), row * width * 4); }
		return Object.freeze({ width, height, pixelsSha256: debugHashCurrentV1(pixels) });
	} finally { joined.fill(0); inflated.fill(0); pixels.fill(0); }
}
function crc(bytes: Uint8Array<ArrayBuffer>): number {
	let value = 0xffff_ffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb8_8320 : 0); } return (value ^ 0xffff_ffff) >>> 0;
}
