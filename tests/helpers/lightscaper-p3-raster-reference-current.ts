/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';

export type RasterTarget = Readonly<{ profile: 'srgb' | 'display-p3'; bitDepth: 8 | 16 }>;

/** The fixture's saved exposure is -1 EV. These literal target dimensions and
 * textbook sampling equations do not call any application planner or kernel. */
export function nativeRasterReference(source: readonly number[], sourceWidth: number, sourceHeight: number,
	width: number, height: number, quality: 'nearest' | 'bilinear'): Float32Array<ArrayBuffer> {
	assert.equal(source.length, sourceWidth * sourceHeight * 4);
	const developed = Float32Array.from(source, (value, index) => index % 4 === 3 ? value : Math.fround(value * .5));
	const output = new Float32Array(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const at = (y * width + x) * 4;
		if (quality === 'nearest' || width === sourceWidth && height === sourceHeight) {
			const sample = (Math.floor(y * sourceHeight / height) * sourceWidth + Math.floor(x * sourceWidth / width)) * 4;
			output.set(developed.subarray(sample, sample + 4), at); continue;
		}
		const sx = (x + .5) * sourceWidth / width - .5, sy = (y + .5) * sourceHeight / height - .5;
		const left = Math.floor(sx), top = Math.floor(sy), fx = sx - left, fy = sy - top;
		let alpha = 0; const rgb = [0, 0, 0];
		for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
			const px = Math.min(sourceWidth - 1, Math.max(0, left + dx)), py = Math.min(sourceHeight - 1, Math.max(0, top + dy));
			const sample = (py * sourceWidth + px) * 4, weighted = developed[sample + 3]! * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
			alpha += weighted;
			for (let channel = 0; channel < 3; channel++) rgb[channel] = rgb[channel]! + developed[sample + channel]! * weighted;
		}
		output.set([...(alpha ? rgb.map(value => value / alpha) : [0, 0, 0]), alpha], at);
	}
	return output;
}

/** Uniform 4:3 marks fill the 4:3 output. Chromatic alpha-over makes stage
 * order and early clipping observable without depending on native font ink. */
export function chromaticRasterReference(source: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
	const output = source.slice(), redAlpha = 128 / 255, blueAlpha = 64 / 255;
	for (let at = 0; at < output.length; at += 4) {
		assert.equal(source[at + 3], 1);
		const red = Math.fround(redAlpha + source[at]! * (1 - redAlpha));
		const green = Math.fround(source[at + 1]! * (1 - redAlpha));
		const blue = Math.fround(source[at + 2]! * (1 - redAlpha));
		output.set([Math.fround(red * (1 - blueAlpha)), Math.fround(green * (1 - blueAlpha)),
			Math.fround(blueAlpha + blue * (1 - blueAlpha)), 1], at);
	}
	return output;
}

/** Independent CSS Color 4 rational D65 matrices, with target clipping only
 * after conversion. No production color conversion or encoder is an oracle. */
export function targetRasterReference(source: Float32Array<ArrayBuffer>, target: RasterTarget): number[] {
	const result: number[] = [], maximum = target.bitDepth === 16 ? 65535 : 255;
	for (let at = 0; at < source.length; at += 4) {
		let red = source[at]!, green = source[at + 1]!, blue = source[at + 2]!;
		if (target.profile === 'display-p3') {
			const x = 506752 / 1228815 * red + 87881 / 245763 * green + 12673 / 70218 * blue;
			const y = 87098 / 409605 * red + 175762 / 245763 * green + 12673 / 175545 * blue;
			const z = 7918 / 409605 * red + 87881 / 737289 * green + 1001167 / 1053270 * blue;
			red = 446124 / 178915 * x - 333277 / 357830 * y - 72051 / 178915 * z;
			green = -14852 / 17905 * x + 63121 / 35810 * y + 423 / 17905 * z;
			blue = 11844 / 330415 * x - 50337 / 660830 * y + 316169 / 330415 * z;
		}
		for (const value of [red, green, blue]) {
			const unit = Math.max(0, Math.min(1, value));
			result.push(Math.round(maximum * (unit <= .0031308 ? 12.92 * unit : 1.055 * unit ** (1 / 2.4) - .055)));
		}
		result.push(Math.round(maximum * source[at + 3]!));
	}
	return result;
}

export function inspectRasterPng(bytes: Uint8Array, width: number, height: number, target: RasterTarget,
	capture: boolean, expected: readonly number[]) {
	assert.ok(bytes.length >= 45 && bytes.length < 16 * 1024 * 1024);
	assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks: { kind: string; body: Uint8Array; raw: Uint8Array }[] = [];
	for (let offset = 8; offset < bytes.length;) {
		assert.ok(offset + 12 <= bytes.length); const length = view.getUint32(offset), end = offset + length + 12;
		assert.ok(end <= bytes.length); assert.equal(view.getUint32(end - 4), crc32(bytes.subarray(offset + 4, end - 4)));
		const kind = new TextDecoder('ascii').decode(bytes.subarray(offset + 4, offset + 8));
		assert.ok(['IHDR', 'sRGB', 'cICP', 'eXIf', 'IDAT', 'IEND'].includes(kind));
		chunks.push({ kind, body: bytes.subarray(offset + 8, end - 4), raw: bytes.subarray(offset, end) }); offset = end;
	}
	const names = chunks.map(chunk => chunk.kind), header = chunks[0]!;
	assert.equal(header.kind, 'IHDR'); assert.equal(header.body.length, 13);
	assert.deepEqual([...header.body], [width >>> 24, width >>> 16 & 255, width >>> 8 & 255, width & 255,
		height >>> 24, height >>> 16 & 255, height >>> 8 & 255, height & 255, target.bitDepth, 6, 0, 0, 0]);
	assert.equal(chunks.at(-1)!.kind, 'IEND'); assert.equal(chunks.at(-1)!.body.length, 0);
	const color = target.profile === 'display-p3' ? 'cICP' : 'sRGB';
	assert.equal(names.filter(name => name === color).length, 1); assert.equal(names[1], color);
	assert.deepEqual([...chunks[1]!.body], color === 'cICP' ? [12, 13, 0, 1] : [0]);
	assert.equal(names.includes(color === 'cICP' ? 'sRGB' : 'cICP'), false);
	assert.equal(names.filter(name => name === 'eXIf').length, capture ? 1 : 0);
	if (capture) assert.equal(names[2], 'eXIf');
	const data = chunks.filter(chunk => chunk.kind === 'IDAT'); assert.ok(data.length > 0);
	assert.ok(names.slice(capture ? 3 : 2, -1).every(name => name === 'IDAT'));
	const stride = width * 4 * target.bitDepth / 8, rows = inflateSync(Buffer.concat(data.map(chunk => chunk.body)), { maxOutputLength: (stride + 1) * height });
	assert.equal(rows.length, (stride + 1) * height); const samples: number[] = [];
	for (let y = 0; y < height; y++) {
		assert.equal(rows[y * (stride + 1)], 0);
		for (let x = 0; x < width * 4; x++) samples.push(target.bitDepth === 16
			? rows.readUInt16BE(y * (stride + 1) + 1 + x * 2) : rows[y * (stride + 1) + 1 + x]!);
	}
	assert.deepEqual(samples, expected);
	const exif = chunks.find(chunk => chunk.kind === 'eXIf');
	const captureFacts = exif ? assertRasterExif(exif.body, width, height, target.profile) : null;
	return { samples, exif: exif?.body ?? null, captureFacts, payload: Buffer.concat(chunks.filter(chunk => chunk.kind !== 'eXIf').map(chunk => chunk.raw)) };
}

function assertRasterExif(bytes: Uint8Array, width: number, height: number, profile: RasterTarget['profile']) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert.deepEqual([...bytes.subarray(0, 8)], [73, 73, 42, 0, 8, 0, 0, 0]);
	function directory(at: number) {
		assert.ok(at >= 8 && at + 2 <= bytes.length); const count = view.getUint16(at, true);
		assert.ok(count <= 32 && at + 2 + count * 12 + 4 <= bytes.length);
		const fields = new Map<number, { type: number; count: number; at: number }>();
		for (let index = 0; index < count; index++) {
			const start = at + 2 + index * 12, type = view.getUint16(start + 2, true), count = view.getUint32(start + 4, true);
			const unit = ({ 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 } as Record<number, number>)[type]; assert.ok(unit);
			const offset = unit * count <= 4 ? start + 8 : view.getUint32(start + 8, true);
			assert.ok(offset + unit * count <= bytes.length); const tag = view.getUint16(start, true);
			assert.equal(fields.has(tag), false); fields.set(tag, { type, count, at: offset });
		}
		assert.equal(view.getUint32(at + 2 + count * 12, true), 0); return fields;
	}
	const integer = (fields: ReturnType<typeof directory>, tag: number) => {
		const field = fields.get(tag); assert.ok(field); assert.equal(field.count, 1); assert.ok(field.type === 3 || field.type === 4);
		return field.type === 3 ? view.getUint16(field.at, true) : view.getUint32(field.at, true);
	};
	const root = directory(8), exif = directory(integer(root, 0x8769));
	assert.equal(integer(root, 0x0112), 1); assert.deepEqual([integer(exif, 0xa002), integer(exif, 0xa003)], [width, height]);
	assert.equal(integer(exif, 0xa001), profile === 'display-p3' ? 65535 : 1);
	assert.equal(root.has(0x013b), false); assert.equal(root.has(0x010e), false); assert.equal(root.has(0x8298), false);
	const text = (fields: ReturnType<typeof directory>, tag: number) => {
		const field = fields.get(tag); if (!field) return null;
		assert.equal(field.type, 2); assert.ok(field.count > 0); assert.equal(bytes[field.at + field.count - 1], 0);
		return new TextDecoder('ascii').decode(bytes.subarray(field.at, field.at + field.count - 1));
	};
	return { cameraMake: text(root, 0x010f), cameraModel: text(root, 0x0110), lensModel: text(exif, 0xa434) };
}
