/* SPDX-License-Identifier: AGPL-3.0-only */

import { AAF_MAXIMUM_BYTES, COMPOUND_SIGNATURE, type CompoundEntry } from './aaf-compound-reader.ts';

const FREE = 0xffff_ffff, END = 0xffff_fffe, SECTOR = 4096;

/** CFB version 4, including mini streams and DIFAT for larger embedded essence. */
export function writeAafCompound(entries: readonly CompoundEntry[]): Uint8Array {
	if (entries.length < 1 || entries.length > 100_000 || entries[0]!.path !== '/') throw new RangeError('Invalid AAF compound entry inventory.');
	const ids = new Map<string, number>(), children = new Map<number, number[]>();
	const names = entries.map((entry, i) => {
		const name = i ? entry.path.slice(entry.path.lastIndexOf('/') + 1) : 'Root Entry';
		const key = entry.path.toUpperCase();
		if (!name || name.length > 31 || /[\\\0]/u.test(name) || ids.has(key) || entry.classId.length !== 16) throw new TypeError('Invalid or duplicate AAF compound entry name.');
		ids.set(key, i); return name;
	});
	entries.forEach((entry, i) => {
		if (!i) return;
		const parent = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/';
		const parentId = ids.get(parent.toUpperCase());
		if (parentId === undefined || entries[parentId]!.data) throw new ReferenceError('Missing AAF compound parent storage.');
		const list = children.get(parentId) ?? []; list.push(i); children.set(parentId, list);
	});
	const fat: number[] = [], blocks: { start: number; data: Uint8Array }[] = [];
	function allocate(data: Uint8Array): number {
		if (!data.length) return END;
		const start = fat.length, count = Math.ceil(data.length / SECTOR);
		if ((start + count + 1) * SECTOR > AAF_MAXIMUM_BYTES) throw new RangeError('AAF output exceeds the 512 MiB limit.');
		for (let i = 0; i < count; i++) fat.push(i === count - 1 ? END : start + i + 1);
		blocks.push({ start, data }); return start;
	}
	const directory = new Uint8Array(Math.ceil(entries.length * 128 / SECTOR) * SECTOR), dir = new DataView(directory.buffer);
	const directoryStart = allocate(directory), miniFat: number[] = [];
	const miniParts: { start: number; data: Uint8Array }[] = [];
	const starts = entries.map((entry, i) => {
		if (!i || !entry.data?.length) return END;
		if (entry.data.length >= 4096) return allocate(entry.data);
		const start = miniFat.length, count = Math.ceil(entry.data.length / 64);
		for (let k = 0; k < count; k++) miniFat.push(k === count - 1 ? END : start + k + 1);
		miniParts.push({ start, data: entry.data }); return start;
	});
	const miniRoot = new Uint8Array(miniFat.length * 64);
	for (const part of miniParts) miniRoot.set(part.data, part.start * 64);
	starts[0] = allocate(miniRoot);
	const miniFatBytes = new Uint8Array(Math.ceil(miniFat.length * 4 / SECTOR) * SECTOR).fill(0xff), miniView = new DataView(miniFatBytes.buffer);
	miniFat.forEach((v, i) => miniView.setUint32(i * 4, v, true));
	const miniFatStart = allocate(miniFatBytes);
	const compare = (a: number, b: number) => names[a]!.length - names[b]!.length || (names[a]!.toUpperCase() < names[b]!.toUpperCase() ? -1 : 1);
	for (const [parent, list] of children) {
		list.sort(compare);
		// Balanced ordered tree, with deepest nodes red to equalize black heights.
		const redLevel = Math.floor(Math.log2(list.length + 1));
		const tree = (lo: number, hi: number, level: number): number => {
			if (lo > hi) return FREE;
			const mid = Math.floor((lo + hi) / 2), id = list[mid]!, offset = id * 128;
			dir.setUint32(offset + 68, tree(lo, mid - 1, level + 1), true);
			dir.setUint32(offset + 72, tree(mid + 1, hi, level + 1), true);
			dir.setUint8(offset + 67, level === redLevel ? 0 : 1); return id;
		};
		dir.setUint32(parent * 128 + 76, tree(0, list.length - 1, 0), true);
	}
	entries.forEach((entry, i) => {
		const offset = i * 128, name = names[i]!;
		for (let k = 0; k < name.length; k++) dir.setUint16(offset + k * 2, name.charCodeAt(k), true);
		dir.setUint16(offset + 64, (name.length + 1) * 2, true);
		dir.setUint8(offset + 66, i === 0 ? 5 : entry.data ? 2 : 1);
		if (!i) { dir.setUint8(offset + 67, 1); dir.setUint32(offset + 68, FREE, true); dir.setUint32(offset + 72, FREE, true); }
		if (!children.has(i)) dir.setUint32(offset + 76, FREE, true);
		directory.set(entry.classId, offset + 80);
		dir.setUint32(offset + 116, starts[i]!, true);
		dir.setBigUint64(offset + 120, BigInt(i === 0 ? miniRoot.length : entry.data?.length ?? 0), true);
	});
	const baseCount = fat.length;
	let fatCount = 0, difatCount = 0;
	for (;;) {
		const nextFat = Math.ceil((baseCount + fatCount + difatCount) / 1024), nextDifat = Math.ceil(Math.max(0, nextFat - 109) / 1023);
		if (fatCount === nextFat && difatCount === nextDifat) break;
		fatCount = nextFat; difatCount = nextDifat;
	}
	for (let i = 0; i < fatCount; i++) fat.push(0xffff_fffd);
	for (let i = 0; i < difatCount; i++) fat.push(0xffff_fffc);
	const bytes = new Uint8Array((fat.length + 1) * SECTOR), view = new DataView(bytes.buffer);
	if (bytes.length > AAF_MAXIMUM_BYTES) throw new RangeError('AAF output exceeds the 512 MiB limit.');
	bytes.set(COMPOUND_SIGNATURE);
	bytes.set([0x01, 0x02, 0x01, 0x0d, 0x00, 0x02, 0x00, 0x00, 0x06, 0x0e, 0x2b, 0x34, 0x03, 0x02, 0x01, 0x01], 8);
	view.setUint16(24, 0x3e, true); view.setUint16(26, 4, true); view.setUint16(28, 0xfffe, true);
	view.setUint16(30, 12, true); view.setUint16(32, 6, true);
	view.setUint32(40, directory.length / SECTOR, true); view.setUint32(44, fatCount, true); view.setUint32(48, directoryStart, true);
	view.setUint32(56, 4096, true); view.setUint32(60, miniFatStart, true); view.setUint32(64, miniFatBytes.length / SECTOR, true);
	view.setUint32(68, difatCount ? baseCount + fatCount : END, true); view.setUint32(72, difatCount, true);
	for (let i = 0; i < 109; i++) view.setUint32(76 + i * 4, i < fatCount ? baseCount + i : FREE, true);
	for (const block of blocks) bytes.set(block.data, (block.start + 1) * SECTOR);
	const fatOffset = (baseCount + 1) * SECTOR;
	bytes.fill(0xff, fatOffset);
	fat.forEach((v, i) => view.setUint32(fatOffset + i * 4, v, true));
	for (let i = 0; i < difatCount; i++) {
		const offset = (baseCount + fatCount + i + 1) * SECTOR;
		for (let k = 0; k < 1023; k++) {
			const id = 109 + i * 1023 + k; view.setUint32(offset + k * 4, id < fatCount ? baseCount + id : FREE, true);
		}
		view.setUint32(offset + SECTOR - 4, i + 1 < difatCount ? baseCount + fatCount + i + 1 : END, true);
	}
	return bytes;
}
