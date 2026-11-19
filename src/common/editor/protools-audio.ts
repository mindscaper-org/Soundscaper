/* SPDX-License-Identifier: AGPL-3.0-only */

import { proToolsChildren, type ProToolsContainer, type ProToolsBlock, type ProToolsReader } from './protools-binary.ts';

export interface ProToolsAudioFile { readonly index: number; readonly name: string; readonly frames: number }
export interface ProToolsRegion {
	readonly name: string;
	readonly start: number;
	readonly sourceStart: number;
	readonly duration: number;
	readonly sourceIndex: number;
}

export function readProToolsAudioFiles(container: ProToolsContainer): readonly ProToolsAudioFile[] {
	const { reader, blocks, version } = container;
	const tables = blocks.filter(block => block.kind === 0x1004);
	if (tables.length !== 1) throw new SyntaxError('A Pro Tools session requires one audio file table.');
	const table = tables[0]!, expected = reader.uint(table.offset + 2, 4, table.end);
	if (expected > 100000) throw new RangeError('Pro Tools audio file count limit exceeded.');
	const names: string[] = [];
	const codes = new Set(['WAVE', 'EVAW', 'AIFF', 'FFIA', 'fFXM', 'MXFf']);
	for (const list of proToolsChildren(table, 0x103a)) {
		for (let offset = list.offset + 11; offset < list.end && names.length < expected;) {
			const name = reader.string(offset, list.end);
			const code = reader.uint(name.next, 4, list.end, false);
			const type = String.fromCharCode(code & 255, code >>> 8 & 255, code >>> 16 & 255, code >>> 24 & 255);
			// The final name has only its four-byte type; the five separator bytes belong to the next entry.
			if (name.next + 9 > list.end && name.next + 4 !== list.end) throw new RangeError('Truncated Pro Tools audio file entry.');
			offset = name.next + 9;
			if (/\.grp$/iu.test(name.text) || ['Audio Files', 'Fade Files'].includes(name.text)) continue;
			if (codes.has(type) || (version >= 10 && type.charCodeAt(0) === 0 && /\.(?:wav|aiff?|mxf)$/iu.test(name.text))) names.push(name.text);
		}
	}
	if (names.length !== expected) throw new SyntaxError('The Pro Tools audio file table is incomplete or uses an unsupported source layout.');
	const lengths = proToolsChildren(table, 0x1003).flatMap(block => proToolsChildren(block, 0x1001))
		.map(block => reader.uint(block.offset + 8, 8, block.end));
	return names.map((name, index) => ({ index, name, frames: lengths[index] ?? 0 }));
}

/** Keep table indexes even for an unsupported definition, so later clips cannot bind to the wrong source. */
export function readProToolsRegions(container: ProToolsContainer): readonly (ProToolsRegion | null)[] {
	const tables = container.blocks.filter(block => block.kind === 0x262a || block.kind === 0x100b);
	if (tables.length > 1) throw new SyntaxError('Ambiguous Pro Tools audio region tables.');
	const table = tables[0];
	if (!table) return [];
	const definitions = proToolsChildren(table, table.kind === 0x262a ? 0x2629 : 0x1008);
	const expected = container.reader.uint(table.offset + 2, 4, table.end);
	if (definitions.length !== expected) throw new SyntaxError('The Pro Tools region table is incomplete.');
	return definitions.map(block => readRegion(container.reader, block));
}

function readRegion(reader: ProToolsReader, block: ProToolsBlock): ProToolsRegion | null {
	const info = block.children[0];
	if (!info || ![0x1007, 0x2628].includes(info.kind)) return null;
	const name = reader.string(info.offset + 2, info.end);
	const start = name.next;
	reader.uint(start, 5, info.end);
	const widths = reader.bigEndian
		? [reader.bytes[start + 4]! >>> 4, reader.bytes[start + 3]! >>> 4, reader.bytes[start + 2]! >>> 4]
		: [reader.bytes[start + 1]! >>> 4, reader.bytes[start + 2]! >>> 4, reader.bytes[start + 3]! >>> 4];
	let offset = start + 5;
	const values = widths.map(width => {
		if (width > 5) throw new RangeError('Unsupported Pro Tools sample field width.');
		const value = reader.uint(offset, width, info.end, false); offset += width; return value;
	});
	return { name: name.text, sourceStart: values[0]!, duration: values[1]!, start: values[2]!,
		sourceIndex: reader.uint(info.end, 4, block.end) };
}
