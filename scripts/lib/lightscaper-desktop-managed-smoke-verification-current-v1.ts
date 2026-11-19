/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { decodeLibRawOriginalWasmV1 } from '../../src/common/editor/raw/libraw-wasm-instance-v1.ts';
import { importPhotoCatalogArchiveV8 } from '../../src/lightscaper/archive/catalog-archive-import-v8.ts';
import type { PhotoCatalogArchiveStageV8 } from '../../src/lightscaper/archive/catalog-archive-import-kernel.ts';
import { normalizePhotoCatalogArchiveV8 } from '../../src/lightscaper/archive/catalog-archive-contract-v8.ts';
import { normalizePhotoCatalogArchiveV7 } from '../../src/lightscaper/archive/catalog-archive-contract-v7.ts';
import { normalizePhotoCatalogArchiveV6 } from '../../src/lightscaper/archive/catalog-archive-contract-v6.ts';
import { normalizePhotoCatalogArchiveV5 } from '../../src/lightscaper/archive/catalog-archive-contract-v5.ts';
import { readScapeArchiveEnvelope } from '../../src/common/editor/scape-archive-envelope.ts';
import { withScapeArchiveReader } from '../../src/common/editor/scape-archive-reader.ts';
import { lightscaperSmokeStableJsonCurrentV1, type LightscaperSmokeCustodyCurrentV1 } from '../../desktop/lightscaper-managed-smoke-contract-current-v1.ts';

export function lightscaperSmokeHashCurrentV1(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

/** Independent final SDR oracle. Only the actual packaged pinned LibRaw native
 * decoder is used; authored exposure and gamma/quantization are scalar literals. */
export async function expectedLightscaperSmokeRawPixelsCurrentV1(runtimeRoot: string, input: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const bytes = await readFile(join(runtimeRoot, 'libraw/0.22.2/libraw.wasm'));
	if (bytes.length !== 876_336 || lightscaperSmokeHashCurrentV1(bytes) !== '7f9f4e791177114e5224e52c85f7be8b5d79bc5e48e1f87a4f69b1f6edf52c29') throw new Error('External RAW oracle requires the actual packaged pinned runtime.');
	const decoded = decodeLibRawOriginalWasmV1(await WebAssembly.compile(new Uint8Array(bytes)), input);
	try {
		if (decoded.rawFlip !== 0 || decoded.frame.descriptor.width !== 32 || decoded.frame.descriptor.height !== 32) throw new Error('Owned RAW oracle geometry changed.');
		return Uint8Array.from(decoded.frame.pixels, (word, index) => {
			if (index % 4 === 3) return 255;
			const linear = Math.fround(Math.fround(word / 65_535) * 0.5), value = Math.max(0, Math.min(1, linear));
			return Math.round(255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055));
		});
	} finally { decoded.frame.pixels.fill(0); }
}

/** Independent PNG chunk/CRC/zlib/filter reader; application codecs and the
 * renderer receipt are not byte-validity or pixel authority here. */
export function verifyLightscaperSmokePngCurrentV1(input: Uint8Array, width: number, height: number, expected: Uint8Array): Readonly<{ width: number; height: number; pixels: readonly number[]; sha256: string }> {
	const bytes = Buffer.from(input);
	if (width !== 32 && width !== 2 || height < 1 || height > 32 || width * height * 4 !== expected.length
		|| bytes.length > 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG signature or bounded dimensions differ.');
	let offset = 8, ihdr = false, ended = false; const compressed: Buffer[] = [];
	while (offset < bytes.length) {
		if (ended || offset + 12 > bytes.length) throw new Error('PNG has trailing or truncated bytes.');
		const size = bytes.readUInt32BE(offset), end = offset + size + 12;
		if (end > bytes.length) throw new Error('PNG chunk exceeds its actual file.');
		const type = bytes.toString('ascii', offset + 4, offset + 8), payload = bytes.subarray(offset + 8, end - 4);
		if (bytes.readUInt32BE(end - 4) !== pngCrc(bytes.subarray(offset + 4, end - 4))) throw new Error('PNG chunk CRC differs.');
		if (type === 'IHDR') {
			if (ihdr || offset !== 8 || size !== 13 || payload.readUInt32BE(0) !== width || payload.readUInt32BE(4) !== height || !payload.subarray(8).equals(Buffer.from([8, 6, 0, 0, 0]))) throw new Error('PNG IHDR differs from actual authored output.');
			ihdr = true;
		} else if (type === 'IDAT') { if (!ihdr) throw new Error('PNG IDAT precedes IHDR.'); compressed.push(payload); }
		else if (type === 'IEND') { if (size !== 0 || compressed.length === 0) throw new Error('PNG IEND is invalid.'); ended = true; }
		else if (!['sRGB', 'gAMA', 'cHRM', 'iCCP', 'eXIf', 'tEXt', 'iTXt'].includes(type)) throw new Error(`Unexpected PNG chunk ${type}.`);
		offset = end;
	}
	if (!ihdr || !ended) throw new Error('PNG file is incomplete.');
	const stride = width * 4, packed = Buffer.concat(compressed);
	const inflated = inflateSync(packed, { maxOutputLength: (stride + 1) * height, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
	if (inflated.engine.bytesWritten !== packed.length) throw new Error('PNG compressed stream has trailing bytes.');
	const raw = inflated.buffer;
	if (raw.length !== (stride + 1) * height) throw new Error('PNG scanline bytes differ.');
	const pixels = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)]!;
		if (filter > 4) throw new Error('PNG filter is invalid.');
		for (let x = 0; x < stride; x++) {
			const at = y * stride + x, a = x >= 4 ? pixels[at - 4]! : 0, b = y ? pixels[at - stride]! : 0, c = y && x >= 4 ? pixels[at - stride - 4]! : 0;
			const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
			pixels[at] = (raw[y * (stride + 1) + x + 1]! + predictor) & 255;
		}
	}
	if (pixels.some((byte, index) => byte !== expected[index])) throw new Error('Actual exported PNG pixels differ from the independent RAW exposure oracle.');
	return Object.freeze({ width, height, pixels: Object.freeze([...pixels]), sha256: lightscaperSmokeHashCurrentV1(bytes) });
}

/** Authenticate the actual downloaded catalog using the maintained closed
 * archive reader into a bounded observation sink, never a fake app repository. */
export async function verifyLightscaperSmokeArchiveCurrentV1(bytes: Uint8Array<ArrayBuffer>, expected: LightscaperSmokeCustodyCurrentV1) {
	if (bytes.length < 8 || bytes.length > 1024 * 1024 || expected.photos.length !== 2) throw new Error('Archive8 exceeds its owned two-photo bounds.');
	const blob = new Blob([bytes]);
	const document = await withScapeArchiveReader(blob, undefined, async entries => {
		const envelope = await readScapeArchiveEnvelope(entries, { maximumProjectBytes: 1024 * 1024 });
		const parsed: unknown = JSON.parse(envelope.projectText);
		const version = parsed && typeof parsed === 'object' ? Object.getOwnPropertyDescriptor(parsed, 'schemaVersion')?.value as unknown : undefined;
		// Current backup chooses the smallest lossless schema for its inventory.
		// The import below authenticates that version's manifest and every body.
		const value = version === 5 ? normalizePhotoCatalogArchiveV5(parsed) : version === 6 ? normalizePhotoCatalogArchiveV6(parsed)
			: version === 7 ? normalizePhotoCatalogArchiveV7(parsed) : normalizePhotoCatalogArchiveV8(parsed);
		if (value.catalog.photoCount !== 2) throw new Error('Downloaded backup is not the complete two-photo catalog.');
		return value;
	});
	if (lightscaperSmokeStableJsonCurrentV1(document.catalog) !== lightscaperSmokeStableJsonCurrentV1(expected.root)) throw new Error('Archive8 root differs from native IDB custody.');
	const photos: unknown[] = []; let published = false;
	await importPhotoCatalogArchiveV8(blob, async () => {
		const stage: PhotoCatalogArchiveStageV8 = {
			async writePhoto(photo, chunks): Promise<void> {
				const prior = expected.photos.find(value => (value.document as { id?: string }).id === photo.id);
				if (!prior || photos.length >= 2 || lightscaperSmokeStableJsonCurrentV1(photo) !== lightscaperSmokeStableJsonCurrentV1(prior.document)) throw new Error('Archive8 Photo differs from its actual saved document.');
				const digest = createHash('sha256'); let length = 0;
				for await (const chunk of chunks) { length += chunk.length; if (length > 65_536) throw new Error('Archive8 Original exceeds its owned fixture.'); digest.update(chunk); }
				if (length !== prior.byteLength || digest.digest('hex') !== prior.sha256) throw new Error('Archive8 Original custody differs from its imported fixture.');
				photos.push({ id: photo.id, byteLength: length, sha256: prior.sha256 });
			},
			async writeStack(): Promise<void> { throw new Error('Unexpected smoke archive stack.'); },
			async writeSavedCollection(): Promise<void> { throw new Error('Unexpected smoke archive filter.'); },
			async writeDevelopPresets(): Promise<void> { throw new Error('Unexpected smoke archive preset.'); },
			async writeLut(): Promise<void> { throw new Error('Unexpected smoke archive LUT.'); },
			async writeMaskRaster(): Promise<void> { throw new Error('Unexpected smoke archive brush.'); },
			async publish(): Promise<void> { if (photos.length !== 2) throw new Error('Archive8 Photo inventory is incomplete.'); published = true; },
			async rollback(): Promise<void> {},
		};
		return stage;
	});
	if (!published || photos.length !== 2) throw new Error('Archive8 authentication did not finish.');
	return { schemaVersion: document.schemaVersion, byteLength: bytes.length, sha256: lightscaperSmokeHashCurrentV1(bytes), photos };
}
function paeth(a: number, b: number, c: number): number {
	const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function pngCrc(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
	return (crc ^ 0xffffffff) >>> 0;
}
