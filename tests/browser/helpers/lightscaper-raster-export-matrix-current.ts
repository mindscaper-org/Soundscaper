/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';
import { numberEntry, pngChunk, rationalEntry, textEntry, tiffFixture } from '../../helpers/image-metadata-fixtures.ts';
import { repairOriginalReferencePixelsV1 } from './lightscaper-repair-spots-reference.ts';

export type MatrixFormat = 'png' | 'jpeg';
export const MATRIX_NAME = 'Matrix original.png';
export const MATRIX_CAMERA = 'Matrix camera';
export const MATRIX_DEVELOPED = [255, 255, 255, 255, 188, 188, 188, 255] as const;

// Literal nearest-neighbor grids for the independently solved Heal, crop,
// horizontal flip and +1 EV. No application renderer or resize planner is used.
export const MATRIX_SIZES = [
	{ kind: 'original', width: 2, height: 1, rows: ['WG'], fields: [], upscale: false },
	{ kind: 'fit', width: 1, height: 1, rows: ['W'], fields: [['width', '1'], ['height', '1']], upscale: false },
	{ kind: 'long-edge', width: 6, height: 3, rows: ['WWWGGG', 'WWWGGG', 'WWWGGG'], fields: [['pixels', '6']], upscale: true },
	{ kind: 'megapixels', width: 4, height: 2, rows: ['WWGG', 'WWGG'], fields: [['megapixels', '0.000008']], upscale: true },
	{ kind: 'percentage', width: 3, height: 2, rows: ['WWG', 'WWG'], fields: [['percentage', '150']], upscale: false },
] as const;
export type MatrixSize = typeof MATRIX_SIZES[number];
export const MATRIX_FORMATS = ['png', 'jpeg'] as const;
export const MATRIX_SCOPES = ['strip', 'capture'] as const;
export const MATRIX_SIDECARS = [false, true] as const;
export const MATRIX_ROLES = MATRIX_FORMATS.flatMap(format => MATRIX_SIZES.flatMap(size =>
	MATRIX_SCOPES.flatMap(scope => MATRIX_SIDECARS.map(sidecar => matrixRole(format, size, scope, sidecar)))));

export function matrixRole(format: MatrixFormat, size: MatrixSize, scope: typeof MATRIX_SCOPES[number], sidecar: boolean): string {
	return `${format}/${size.kind}/${scope}/sidecar-${sidecar ? 'on' : 'off'}`;
}
export function matrixPixels(size: MatrixSize): number[] {
	return size.rows.flatMap(row => [...row].flatMap(key => {
		if (key !== 'W' && key !== 'G') throw new Error('Unknown literal matrix sample.');
		const value = key === 'W' ? 255 : 188; return [value, value, value, 255];
	}));
}
export function matrixSha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

export function matrixOriginalPng(): Buffer {
	const header = Buffer.alloc(13); header.writeUInt32BE(10, 0); header.writeUInt32BE(5, 4); header.set([8, 6], 8);
	const pixels = repairOriginalReferencePixelsV1(), rows: number[] = [];
	for (let y = 0; y < 5; y++) rows.push(0, ...pixels.slice(y * 40, (y + 1) * 40));
	const tiff = tiffFixture([
		numberEntry(0x0112, 1), textEntry(0x010f, MATRIX_CAMERA), textEntry(0x0110, 'Matrix model'),
		textEntry(0x013b, 'Original private artist'), textEntry(0x010e, 'Original private description'),
		textEntry(0x8298, 'Original private rights'),
	], [rationalEntry(0x829a, 1, 125), rationalEntry(0x829d, 4, 1), numberEntry(0x8827, 200),
		rationalEntry(0x920a, 35, 1), textEntry(0xa434, 'Matrix lens'), textEntry(0x9003, '2026:10:08 11:12:13'),
		textEntry(0x9011, '+02:00'), textEntry(0x9291, '123')]);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
		pngChunk('sRGB', Buffer.from([0])), pngChunk('eXIf', tiff),
		pngChunk('tEXt', Buffer.from('XML:com.adobe.xmp\0Original private XMP')),
		pngChunk('IDAT', deflateSync(Uint8Array.from(rows))), pngChunk('IEND', new Uint8Array())]);
}

interface ParsedImage {
	readonly tiffs: readonly Buffer[];
	readonly payloadSha256: string;
	readonly pixels?: readonly number[];
}

/** Independent container, CRC/entropy framing and metadata checks on the
 * delivered file. JPEG compression itself is decoded by the real browser. */
export function inspectMatrixArtifact(format: MatrixFormat, bytes: Buffer, size: MatrixSize, capture: boolean) {
	expect(bytes.length).toBeGreaterThan(32); expect(bytes.length).toBeLessThanOrEqual(65_536);
	const parsed = format === 'png' ? inspectPng(bytes, size) : inspectJpeg(bytes, size);
	assertCapture(parsed.tiffs, capture, size);
	for (const privateText of ['Original private artist', 'Original private description', 'Original private rights', 'Original private XMP']) {
		expect(bytes.includes(Buffer.from(privateText))).toBe(false);
	}
	if (format === 'png') expect(parsed.pixels).toEqual(matrixPixels(size));
	return { encodedSha256: matrixSha256(bytes), payloadSha256: parsed.payloadSha256,
		metadataSha256: parsed.tiffs[0] ? matrixSha256(parsed.tiffs[0]) : null };
}

function inspectPng(bytes: Buffer, size: MatrixSize): ParsedImage {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const tiffs: Buffer[] = [], compressed: Buffer[] = [], payload: Buffer[] = [bytes.subarray(0, 8)];
	let offset = 8, chunks = 0, ended = false, color = false;
	while (offset < bytes.length) {
		expect(++chunks).toBeLessThanOrEqual(64); expect(offset + 12).toBeLessThanOrEqual(bytes.length);
		const length = bytes.readUInt32BE(offset), end = offset + length + 12;
		expect(end).toBeLessThanOrEqual(bytes.length); expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4)));
		const kind = bytes.toString('ascii', offset + 4, offset + 8), body = bytes.subarray(offset + 8, end - 4);
		expect(['IHDR', 'sRGB', 'cICP', 'eXIf', 'IDAT', 'IEND']).toContain(kind);
		if (kind === 'IHDR') {
			expect(offset).toBe(8); expect(length).toBe(13);
			expect([body.readUInt32BE(0), body.readUInt32BE(4)]).toEqual([size.width, size.height]);
			expect([...body.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
		} else if (kind === 'sRGB') { expect([...body]).toEqual([0]); color = true; }
		else if (kind === 'cICP') { expect([...body]).toEqual([1, 13, 0, 1]); color = true; }
		else if (kind === 'eXIf') tiffs.push(body);
		else if (kind === 'IDAT') compressed.push(body);
		else if (kind === 'IEND') { expect(length).toBe(0); expect(end).toBe(bytes.length); ended = true; }
		if (kind !== 'eXIf') payload.push(bytes.subarray(offset, end));
		offset = end;
	}
	expect(ended && color).toBe(true); expect(compressed.length).toBeGreaterThan(0);
	const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: 1024 });
	const stride = size.width * 4; expect(raw.length).toBe((stride + 1) * size.height);
	const pixels = Buffer.alloc(stride * size.height);
	for (let y = 0; y < size.height; y++) {
		const filter = raw[y * (stride + 1)]!; expect(filter).toBeLessThanOrEqual(4);
		for (let x = 0; x < stride; x++) {
			const index = y * stride + x, left = x >= 4 ? pixels[index - 4]! : 0;
			const up = y ? pixels[index - stride]! : 0, upperLeft = y && x >= 4 ? pixels[index - stride - 4]! : 0;
			const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
				: filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
			pixels[index] = (raw[y * (stride + 1) + x + 1]! + predictor) & 255;
		}
	}
	return { tiffs, payloadSha256: matrixSha256(Buffer.concat(payload)), pixels: [...pixels] };
}

function paeth(left: number, up: number, upperLeft: number): number {
	const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
	return a <= b && a <= c ? left : b <= c ? up : upperLeft;
}

function inspectJpeg(bytes: Buffer, size: MatrixSize): ParsedImage {
	expect([...bytes.subarray(0, 2)]).toEqual([255, 216]);
	const tiffs: Buffer[] = [], exclusions: [number, number][] = [];
	let offset = 2, inScan = false, sawScan = false, frames = 0, ended = false, markers = 0;
	while (offset < bytes.length) {
		if (inScan && bytes[offset] !== 255) { offset++; continue; }
		const start = offset; expect(bytes[offset++]).toBe(255);
		while (bytes[offset] === 255) offset++;
		const marker = bytes[offset++]; expect(marker).toBeDefined();
		if (inScan && (marker === 0 || marker! >= 0xd0 && marker! <= 0xd7)) continue;
		inScan = false; expect(++markers).toBeLessThanOrEqual(256);
		if (marker === 0xd9) { expect(offset).toBe(bytes.length); ended = true; break; }
		expect([0, 0xd8, 0xed, 0xfe]).not.toContain(marker); if (marker === 1) continue;
		expect(offset + 2).toBeLessThanOrEqual(bytes.length);
		const length = bytes.readUInt16BE(offset), end = offset + length;
		expect(length).toBeGreaterThanOrEqual(2); expect(end).toBeLessThanOrEqual(bytes.length);
		if (marker === 0xe1) {
			expect(bytes.toString('ascii', offset + 2, offset + 8)).toBe('Exif\0\0');
			tiffs.push(bytes.subarray(offset + 8, end)); exclusions.push([start, end]);
		}
		if (marker! >= 0xc0 && marker! <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker!)) {
			expect([0xc0, 0xc1, 0xc2]).toContain(marker); expect(++frames).toBe(1);
			expect(bytes[offset + 2]).toBe(8); expect([bytes.readUInt16BE(offset + 3), bytes.readUInt16BE(offset + 5)]).toEqual([size.height, size.width]);
		}
		if (marker === 0xda) { expect(frames).toBe(1); inScan = true; sawScan = true; }
		offset = end;
	}
	expect(ended && sawScan).toBe(true); expect(frames).toBe(1);
	const payload: Buffer[] = []; let from = 0;
	for (const [start, end] of exclusions) { payload.push(bytes.subarray(from, start)); from = end; }
	payload.push(bytes.subarray(from)); return { tiffs, payloadSha256: matrixSha256(Buffer.concat(payload)) };
}

type TiffValue = string | number | number[];
function tiffDirectory(bytes: Buffer, offset: number): Map<number, TiffValue> {
	expect(offset).toBeGreaterThanOrEqual(8); expect(offset + 2).toBeLessThanOrEqual(bytes.length);
	const count = bytes.readUInt16LE(offset), entries = new Map<number, TiffValue>();
	expect(count).toBeLessThanOrEqual(32); expect(offset + 6 + count * 12).toBeLessThanOrEqual(bytes.length);
	for (let index = 0; index < count; index++) {
		const at = offset + 2 + index * 12, tag = bytes.readUInt16LE(at), type = bytes.readUInt16LE(at + 2), units = bytes.readUInt32LE(at + 4);
		const unit = ({ 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 } as Record<number, number>)[type];
		expect(unit).toBeDefined(); expect(units).toBeGreaterThan(0); expect(units).toBeLessThanOrEqual(1024);
		const length = units * unit!, body = length <= 4 ? at + 8 : bytes.readUInt32LE(at + 8);
		expect(body + length).toBeLessThanOrEqual(bytes.length); expect(entries.has(tag)).toBe(false);
		if (type === 2) { expect(bytes[body + length - 1]).toBe(0); entries.set(tag, bytes.toString('ascii', body, body + length - 1)); }
		else if (type === 3) { expect(units).toBe(1); entries.set(tag, bytes.readUInt16LE(body)); }
		else if (type === 4) { expect(units).toBe(1); entries.set(tag, bytes.readUInt32LE(body)); }
		else if (type === 5) { expect(units).toBe(1); entries.set(tag, [bytes.readUInt32LE(body), bytes.readUInt32LE(body + 4)]); }
		else entries.set(tag, [...bytes.subarray(body, body + length)]);
	}
	expect(bytes.readUInt32LE(offset + 2 + count * 12)).toBe(0); return entries;
}

function assertCapture(tiffs: readonly Buffer[], capture: boolean, size: MatrixSize): void {
	expect(tiffs).toHaveLength(capture ? 1 : 0); if (!capture) return;
	const bytes = tiffs[0]!; expect([...bytes.subarray(0, 8)]).toEqual([73, 73, 42, 0, 8, 0, 0, 0]);
	const root = tiffDirectory(bytes, 8), exifOffset = root.get(0x8769);
	if (typeof exifOffset !== 'number') throw new Error('Capture EXIF directory pointer is not an integer.');
	const exif = tiffDirectory(bytes, exifOffset), keys = (entries: Map<number, TiffValue>) => [...entries.keys()].sort((a, b) => a - b);
	expect(keys(root)).toEqual([0x010f, 0x0110, 0x0112, 0x8769]);
	expect(keys(exif)).toEqual([0x829a, 0x829d, 0x8827, 0x8830, 0x8833, 0x9000, 0x9003, 0x9011, 0x920a, 0x9291, 0xa001, 0xa002, 0xa003, 0xa434]);
	expect(root.get(0x010f)).toBe(MATRIX_CAMERA); expect(root.get(0x0110)).toBe('Matrix model'); expect(root.get(0x0112)).toBe(1);
	expect(exif.get(0xa434)).toBe('Matrix lens'); expect(exif.get(0x829a)).toEqual([1, 125]); expect(exif.get(0x829d)).toEqual([4, 1]);
	expect(exif.get(0x920a)).toEqual([35, 1]); expect(exif.get(0x8827)).toBe(200); expect(exif.get(0x8833)).toBe(200);
	expect(exif.get(0x8830)).toBe(3); expect(exif.get(0x9000)).toEqual([48, 50, 51, 50]);
	expect(exif.get(0x9003)).toBe('2026:10:08 11:12:13'); expect(exif.get(0x9011)).toBe('+02:00'); expect(exif.get(0x9291)).toBe('123');
	expect(exif.get(0xa001)).toBe(1); expect(exif.get(0xa002)).toBe(size.width); expect(exif.get(0xa003)).toBe(size.height);
}

/** Native codec readback owns one at-most-6x3 bitmap and canvas at a time. */
export async function decodeMatrixArtifact(page: Page, bytes: Buffer, format: MatrixFormat, size: MatrixSize): Promise<number[]> {
	return page.evaluate(async ({ encoded, format, width, height }) => {
		const blob = new Blob([Uint8Array.from(encoded)], { type: format === 'png' ? 'image/png' : 'image/jpeg' });
		const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
		try {
			if (bitmap.width !== width || bitmap.height !== height || width > 6 || height > 3) throw new Error('Native decoded matrix geometry differs.');
			canvas.width = width; canvas.height = height;
			const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
			if (!context) throw new Error('Native matrix 2D decoder readback is unavailable.');
			context.drawImage(bitmap, 0, 0); return [...context.getImageData(0, 0, width, height).data];
		} finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
	}, { encoded: [...bytes], format, width: size.width, height: size.height });
}
