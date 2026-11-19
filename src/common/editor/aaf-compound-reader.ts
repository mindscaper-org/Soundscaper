/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded MS-CFB reader. AAF objects are storages; properties and essence are streams. */
export interface CompoundEntry {
	readonly path: string;
	readonly classId: Uint8Array;
	readonly data?: Uint8Array;
}
const END = 0xffff_fffe, FREE = 0xffff_ffff;
export const AAF_MAXIMUM_BYTES = 512 * 1024 * 1024;
export const COMPOUND_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

export function readAafCompound(bytes: Uint8Array): CompoundEntry[] {
	if (bytes.length < 512 || bytes.length > AAF_MAXIMUM_BYTES || !COMPOUND_SIGNATURE.every((v, i) => bytes[i] === v)) throw new TypeError('Invalid or excessive AAF compound file.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getUint16(26, true), shift = view.getUint16(30, true), sectorSize = 2 ** shift;
	if (view.getUint16(28, true) !== 0xfffe || !((version === 3 && shift === 9) || (version === 4 && (shift === 9 || shift === 12)))
		|| view.getUint16(32, true) !== 6 || view.getUint32(56, true) !== 4096 || bytes.length % sectorSize !== 0) throw new TypeError('Unsupported AAF compound geometry.');
	const sectorCount = bytes.length / sectorSize - 1;
	const sector = (id: number): Uint8Array => {
		if (id >= sectorCount) throw new RangeError('AAF compound sector is outside the file.');
		return bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
	};
	const words = (data: Uint8Array): number[] => {
		const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
		return Array.from({ length: data.length / 4 }, (_, i) => v.getUint32(i * 4, true));
	};
	const fatIds = words(bytes.subarray(76, 512)).filter(id => id !== FREE);
	const difatIds = new Set<number>();
	let difat = view.getUint32(68, true);
	const difatCount = view.getUint32(72, true), fatCount = view.getUint32(44, true);
	if (fatCount > Math.ceil(sectorCount / (sectorSize / 4)) + 1 || difatCount > Math.ceil(Math.max(0, fatCount - 109) / (sectorSize / 4 - 1))) throw new RangeError('Excessive AAF compound allocation tables.');
	for (let i = 0; i < difatCount; i++) {
		if (difatIds.has(difat)) throw new TypeError('Cyclic AAF compound DIFAT.');
		difatIds.add(difat);
		const entries = words(sector(difat)); difat = entries.pop()!;
		fatIds.push(...entries.filter(id => id !== FREE));
	}
	if (difatCount && difat !== END || fatIds.length !== fatCount || new Set(fatIds).size !== fatCount) throw new TypeError('Invalid AAF compound FAT inventory.');
	const fat = fatIds.flatMap(id => words(sector(id)));
	const claimed = new Set([...fatIds, ...difatIds]);
	function chain(start: number, table: readonly number[], limit: number, used: Set<number>): number[] {
		const result: number[] = [];
		if (start === FREE) return result;
		for (let id = start; id !== END;) {
			if (id >= limit || used.has(id) || table[id] === undefined) throw new RangeError('Invalid, shared or cyclic AAF compound sector chain.');
			used.add(id); result.push(id); id = table[id]!;
		}
		return result;
	}
	let allocated = 0;
	function assemble(ids: readonly number[], size: number, blockSize: number, read: (id: number) => Uint8Array): Uint8Array {
		if (!Number.isSafeInteger(size) || size < 0 || size > AAF_MAXIMUM_BYTES || ids.length !== Math.ceil(size / blockSize)) throw new RangeError('AAF compound stream size disagrees with its sector chain.');
		allocated += size;
		if (allocated > AAF_MAXIMUM_BYTES * 2) throw new RangeError('AAF compound streams exceed the decoded byte limit.');
		const data = new Uint8Array(size);
		ids.forEach((id, i) => data.set(read(id).subarray(0, Math.min(blockSize, size - i * blockSize)), i * blockSize));
		return data;
	}
	const directoryIds = chain(view.getUint32(48, true), fat, sectorCount, claimed);
	if (version === 4 && directoryIds.length !== view.getUint32(40, true)) throw new TypeError('Invalid AAF compound directory length.');
	const directory = assemble(directoryIds, directoryIds.length * sectorSize, sectorSize, sector);
	if (directory.length < 128 || directory.length / 128 > 100_000) throw new RangeError('Excessive or empty AAF compound directory.');
	const dirs = new DataView(directory.buffer), count = directory.length / 128;
	const sizeOf = (offset: number): number => {
		const value = dirs.getBigUint64(offset + 120, true);
		if (value > BigInt(AAF_MAXIMUM_BYTES)) throw new RangeError('Excessive AAF compound stream.');
		return Number(value);
	};
	if (dirs.getUint8(66) !== 5) throw new TypeError('AAF compound root storage is missing.');
	const miniRootSize = sizeOf(0), miniRootIds = chain(dirs.getUint32(116, true), fat, sectorCount, claimed);
	const miniRoot = assemble(miniRootIds, miniRootSize, sectorSize, sector);
	const miniFatCount = view.getUint32(64, true);
	const miniFatIds = chain(view.getUint32(60, true), fat, sectorCount, claimed);
	if (miniFatIds.length !== miniFatCount) throw new TypeError('Invalid AAF compound mini FAT length.');
	const miniFat = words(assemble(miniFatIds, miniFatCount * sectorSize, sectorSize, sector)), miniClaimed = new Set<number>();
	const result: CompoundEntry[] = [{ path: '/', classId: directory.slice(80, 96) }], visited = new Set([0]);
	const decoder = new TextDecoder('utf-16le', { fatal: true });
	function walk(id: number, parent: string, depth: number): void {
		if (id === FREE) return;
		if (id >= count || visited.has(id) || depth > 64) throw new RangeError('Invalid or cyclic AAF compound directory tree.');
		visited.add(id);
		const offset = id * 128, type = dirs.getUint8(offset + 66), length = dirs.getUint16(offset + 64, true);
		if (![1, 2].includes(type) || length < 2 || length > 64 || length % 2 || dirs.getUint16(offset + length - 2, true)) throw new TypeError('Invalid AAF compound directory entry.');
		const name = decoder.decode(directory.subarray(offset, offset + length - 2));
		if (!name || /[/\\\0]/u.test(name)) throw new TypeError('Invalid AAF compound entry name.');
		const path = `${parent}/${name}`, classId = directory.slice(offset + 80, offset + 96);
		walk(dirs.getUint32(offset + 68, true), parent, depth + 1);
		if (result.length >= 100_000) throw new RangeError('Excessive AAF compound entries.');
		if (type === 1) {
			result.push({ path, classId });
			walk(dirs.getUint32(offset + 76, true), path, depth + 1);
		} else {
			const size = sizeOf(offset), start = dirs.getUint32(offset + 116, true);
			const data = size < 4096
				? assemble(chain(start, miniFat, Math.ceil(miniRoot.length / 64), miniClaimed), size, 64, i => miniRoot.subarray(i * 64, i * 64 + 64))
				: assemble(chain(start, fat, sectorCount, claimed), size, sectorSize, sector);
			result.push({ path, classId, data });
		}
		walk(dirs.getUint32(offset + 72, true), parent, depth + 1);
	}
	walk(dirs.getUint32(76, true), '', 0);
	const paths = new Set<string>();
	for (const entry of result) {
		const key = entry.path.toUpperCase();
		if (paths.has(key)) throw new TypeError('Duplicate AAF compound storage name.');
		paths.add(key);
	}
	return result;
}
