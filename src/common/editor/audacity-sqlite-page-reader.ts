/* SPDX-License-Identifier: AGPL-3.0-only */

// SQLite table cells and overflow chains: https://sqlite.org/fileformat2.html
// Only follow the live sampleblocks tree. Never scan detached/deleted records
// or guess the continuation of a broken chain from adjacent disk pages.
import { AUP4_MAX_BLOCK_SAMPLES } from './aup4-profile-values.js';

export class AudacitySqlitePageError extends Error {}

export interface AudacityPageSource {
	readonly byteLength: number;
	read(offset: number, length: number): Uint8Array | Promise<Uint8Array>;
}
export interface AudacityPageSamples {
	readonly sampleFormat: number;
	readonly samples: Uint8Array;
	readonly readableBytes: number;
}

export async function createAudacitySqlitePageReader(source: AudacityPageSource, rootPage: number) {
	if (!Number.isSafeInteger(source.byteLength) || source.byteLength < 100) throw new AudacitySqlitePageError('Invalid SQLite source length.');
	const header = await source.read(0, 100);
	if (header.byteLength !== 100) throw new AudacitySqlitePageError('Truncated SQLite header.');
	if (new TextDecoder().decode(header.subarray(0, 16)) !== 'SQLite format 3\0') throw new AudacitySqlitePageError('Invalid SQLite header.');
	const encodedSize = view(header).getUint16(16);
	const pageSize = encodedSize === 1 ? 65536 : encodedSize;
	if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1))) throw new AudacitySqlitePageError('Invalid SQLite page size.');
	const usable = pageSize - header[20]!;
	const pageCount = Math.floor(source.byteLength / pageSize);
	if (usable < 480 || pageCount > 32_000_000) throw new AudacitySqlitePageError('SQLite recovery page budget exceeded.');
	const free = new Uint8Array(Math.ceil((pageCount + 1) / 8));
	const isFree = (id: number): boolean => Boolean(free[id >>> 3]! & (1 << (id & 7)));
	const markFree = (id: number): void => {
		if (!validPage(id) || isFree(id)) throw new AudacitySqlitePageError('Invalid SQLite freelist; refusing to resurrect deleted audio.');
		free[id >>> 3] = free[id >>> 3]! | (1 << (id & 7));
	};
	function validPage(id: number): boolean { return Number.isSafeInteger(id) && id >= 1 && id <= pageCount; }
	async function page(id: number): Promise<Uint8Array> {
		if (!validPage(id)) throw new AudacitySqlitePageError('SQLite page pointer is outside the source.');
		const bytes = await source.read((id - 1) * pageSize, pageSize);
		if (bytes.byteLength !== pageSize) throw new AudacitySqlitePageError('Truncated SQLite page.');
		return bytes;
	}
	let trunk = view(header).getUint32(32), freeCount = 0;
	while (trunk) {
		markFree(trunk); freeCount++;
		const bytes = await page(trunk), data = view(bytes), count = data.getUint32(4);
		if (count > Math.floor(usable / 4) - 2) throw new AudacitySqlitePageError('Invalid SQLite freelist trunk.');
		for (let index = 0; index < count; index++) { markFree(data.getUint32(8 + index * 4)); freeCount++; }
		trunk = data.getUint32(0);
	}
	if (freeCount !== view(header).getUint32(36)) throw new AudacitySqlitePageError('SQLite freelist inventory is inconsistent.');
	return { readSampleBlock };

	async function readSampleBlock(blockId: number): Promise<AudacityPageSamples | null> {
		try { return await readRecord(await findCell(blockId)); }
		catch (error) { if (error instanceof AudacitySqlitePageError) return null; throw error; }
	}

	async function findCell(blockId: number): Promise<{ bytes: Uint8Array; offset: number; tree: Set<number> }> {
		if (!Number.isSafeInteger(blockId) || blockId < 1) throw new AudacitySqlitePageError('Invalid block identity.');
		const tree = new Set<number>();
		let id = rootPage;
		for (let depth = 0; depth < 64; depth++) {
			if (isFree(id) || tree.has(id)) throw new AudacitySqlitePageError('Invalid SQLite tree pointer.');
			tree.add(id);
			const bytes = await page(id), data = view(bytes), base = id === 1 ? 100 : 0;
			const type = bytes[base], interior = type === 5;
			if (!interior && type !== 13) throw new AudacitySqlitePageError('Unreadable SQLite table page.');
			const count = data.getUint16(base + 3), pointerStart = base + (interior ? 12 : 8);
			if (pointerStart + count * 2 > usable) throw new AudacitySqlitePageError('Invalid SQLite cell count.');
			let child = interior ? data.getUint32(base + 8) : 0;
			for (let index = 0; index < count; index++) {
				const offset = data.getUint16(pointerStart + index * 2);
				if (offset < pointerStart + count * 2 || offset >= usable) throw new AudacitySqlitePageError('Invalid SQLite cell offset.');
				const cursor = { offset: offset + (interior ? 4 : 0) };
				if (!interior) varint(bytes, cursor); // Payload size precedes the rowid.
				const rowId = varint(bytes, cursor);
				if (!interior && rowId === blockId) return { bytes, offset, tree };
				if (interior && blockId <= rowId) { child = data.getUint32(offset); break; }
			}
			if (!interior) throw new AudacitySqlitePageError('Sample block is absent from the live tree.');
			id = child;
		}
		throw new AudacitySqlitePageError('SQLite tree depth exceeded.');
	}

	async function readRecord(cell: Awaited<ReturnType<typeof findCell>>): Promise<AudacityPageSamples> {
		const cursor = { offset: cell.offset };
		const length = varint(cell.bytes, cursor);
		varint(cell.bytes, cursor);
		if (length < 8 || length > AUP4_MAX_BLOCK_SAMPLES * 4 + 65536) throw new AudacitySqlitePageError('Unsupported Audacity sample-block size.');
		const minimum = Math.floor((usable - 12) * 32 / 255) - 23;
		const candidate = minimum + (length - minimum) % (usable - 4);
		const local = length <= usable - 35 ? length : candidate <= usable - 35 ? candidate : minimum;
		if (cursor.offset + local + (local < length ? 4 : 0) > usable) throw new AudacitySqlitePageError('Invalid SQLite local payload.');
		const payload = new Uint8Array(length);
		payload.set(cell.bytes.subarray(cursor.offset, cursor.offset + local));
		let readable = local;
		let next = local < length ? view(cell.bytes).getUint32(cursor.offset + local) : 0;
		const visited = new Set(cell.tree);
		while (readable < length && next && validPage(next) && !isFree(next) && !visited.has(next)) {
			visited.add(next);
			const bytes = await page(next), following = view(bytes).getUint32(0);
			// A zeroed page has lost its continuation and its contents together.
			if (!following && readable + usable - 4 < length && bytes.every(byte => byte === 0)) break;
			const count = Math.min(length - readable, usable - 4);
			payload.set(bytes.subarray(4, 4 + count), readable); readable += count;
			next = following;
		}
		const headerCursor = { offset: 0 }, headerSize = varint(payload, headerCursor);
		if (headerSize > local || headerSize > 128) throw new AudacitySqlitePageError('Unreadable SQLite record header.');
		const serials: number[] = [];
		while (headerCursor.offset < headerSize) serials.push(varint(payload, headerCursor));
		if (headerCursor.offset !== headerSize || serials.length !== 8 || serials[0] !== 0
			|| ![1, 2, 3, 4].includes(serials[1]!)
			|| !serials.slice(5).every(serial => serial >= 12 && serial % 2 === 0)) throw new AudacitySqlitePageError('Not an Audacity sample-block record.');
		const sizes = serials.map(serialSize);
		const formatOffset = headerSize, formatBytes = sizes[1]!;
		let sampleFormat = 0;
		for (let index = 0; index < formatBytes; index++) sampleFormat = sampleFormat * 256 + payload[formatOffset + index]!;
		if (![0x00020001, 0x00040001, 0x0004000f].includes(sampleFormat)) throw new AudacitySqlitePageError('Unsupported sample format.');
		const sampleOffset = headerSize + sizes.slice(0, 7).reduce((sum, size) => sum + size, 0);
		const sampleBytes = sizes[7]!, width = sampleFormat >>> 16;
		if (sampleOffset + sampleBytes !== length || sampleBytes % width || sampleBytes / width > AUP4_MAX_BLOCK_SAMPLES
			|| sampleOffset > readable) throw new AudacitySqlitePageError('Invalid Audacity PCM layout.');
		const readableBytes = Math.floor(Math.max(0, readable - sampleOffset) / width) * width;
		const samples = payload.slice(sampleOffset);
		samples.fill(0, readableBytes);
		return { sampleFormat, samples, readableBytes };
	}
}

function serialSize(serial: number): number {
	if ([0, 8, 9].includes(serial)) return 0;
	if (serial >= 1 && serial <= 4) return serial;
	if (serial === 5) return 6;
	if (serial === 6 || serial === 7) return 8;
	if (serial >= 12) return Math.floor((serial - 12) / 2);
	throw new AudacitySqlitePageError('Invalid SQLite serial type.');
}
function varint(bytes: Uint8Array, cursor: { offset: number }): number {
	let result = 0;
	for (let index = 0; index < 9; index++) {
		const byte = bytes[cursor.offset++];
		if (byte === undefined) throw new AudacitySqlitePageError('Truncated SQLite varint.');
		result = result * (index === 8 ? 256 : 128) + (index === 8 ? byte : byte & 127);
		if (!Number.isSafeInteger(result)) throw new AudacitySqlitePageError('SQLite varint exceeds the safe integer range.');
		if (index === 8 || byte < 128) return result;
	}
	throw new AudacitySqlitePageError('Invalid SQLite varint.');
}
function view(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
