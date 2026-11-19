/* SPDX-License-Identifier: AGPL-3.0-only */

/** Wire-layout reference: libptformat af15ee90825f59b84b9977591862cce96bb1d781.
 * This bounded TypeScript implementation does not execute or bundle that library. */
export const PROTOOLS_MAXIMUM_BYTES = 64 * 1024 * 1024;
const MAXIMUM_BLOCKS = 100000;
const MAXIMUM_DEPTH = 64;
const STRUCTURAL_KINDS = new Set([0x0003, 0x2067, 0x1001, 0x1003, 0x1004, 0x1028, 0x103a, 0x1007, 0x1008,
	0x100b, 0x1012, 0x1011, 0x100f, 0x100e, 0x1015, 0x1014, 0x1054, 0x1052, 0x1050, 0x104f, 0x262a, 0x2629, 0x2628]);

export interface ProToolsBlock {
	readonly start: number;
	/** Includes the two-byte content kind. */
	readonly offset: number;
	readonly end: number;
	readonly kind: number;
	readonly children: readonly ProToolsBlock[];
}

export class ProToolsReader {
	readonly bigEndian: boolean;
	legacyStrings = 0;
	constructor(readonly bytes: Uint8Array) { this.bigEndian = bytes[0x11] === 1; }

	uint(offset: number, width: number, end = this.bytes.length, bigEndian = this.bigEndian): number {
		if (!Number.isSafeInteger(offset) || offset < 0 || width < 0 || width > 8 || offset + width > end || end > this.bytes.length) {
			throw new RangeError('A Pro Tools field exceeds its containing block.');
		}
		let value = 0n;
		for (let index = 0; index < width; index++) value = value * 256n + BigInt(this.bytes[offset + (bigEndian ? index : width - index - 1)]!);
		if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('A Pro Tools integer exceeds the safe range.');
		return Number(value);
	}

	string(offset: number, end: number): { text: string; next: number } {
		const length = this.uint(offset, 4, end), next = offset + 4 + length;
		if (length > 4096 || next > end) throw new RangeError('A Pro Tools string exceeds its block or name limit.');
		const bytes = this.bytes.subarray(offset + 4, next);
		let text: string;
		try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
		catch { this.legacyStrings++; text = new TextDecoder(this.bigEndian ? 'macintosh' : 'windows-1252').decode(bytes); }
		return { text, next };
	}
}

export interface ProToolsContainer {
	readonly reader: ProToolsReader;
	readonly version: number;
	readonly blocks: readonly ProToolsBlock[];
}

export function readProToolsContainer(input: Uint8Array): ProToolsContainer {
	if (!(input instanceof Uint8Array) || input.length < 0x41) throw new RangeError('The Pro Tools session header is too short.');
	if (input.length > PROTOOLS_MAXIMUM_BYTES) throw new RangeError('The Pro Tools session exceeds the byte limit.');
	if (input[0] !== 3 || new TextDecoder().decode(input.subarray(1, 17)) !== '0010111100101011' || input[0x11]! > 1) {
		throw new SyntaxError('The file has no supported Pro Tools signature.');
	}
	const scheme = input[0x12], seed = input[0x13]!;
	if (scheme !== 1 && scheme !== 5) throw new RangeError('Unsupported Pro Tools XOR scheme.');
	const bytes = new Uint8Array(input);
	// 29 and 163 are the modular inverses of the two wire multipliers, 53 and 11.
	const delta = (scheme === 1 ? seed * 29 : -seed * 163) & 255;
	for (let index = 20; index < bytes.length; index++) bytes[index] = bytes[index]! ^ (((scheme === 1 ? index : index >>> 12) & 255) * delta & 255);
	const reader = new ProToolsReader(bytes);
	let count = 0;
	const scan = (start: number, end: number, depth: number): readonly ProToolsBlock[] => {
		if (depth > MAXIMUM_DEPTH) throw new RangeError('Pro Tools block nesting depth limit exceeded.');
		const blocks: ProToolsBlock[] = [];
		for (let position = start; position < end;) {
			if (bytes[position] !== 0x5a || position + 9 > end) { position++; continue; }
			const type = reader.uint(position + 1, 2, end), size = reader.uint(position + 3, 4, end);
			const offset = position + 7, kind = reader.uint(offset, 2, end), blockEnd = offset + size;
			if (type > 255) { position++; continue; }
			if (size < 2 || blockEnd > end) {
				if (STRUCTURAL_KINDS.has(kind)) throw new RangeError('A Pro Tools structural block is truncated or has an invalid size.');
				position++; continue;
			}
			if (++count > MAXIMUM_BLOCKS) throw new RangeError('Pro Tools block count limit exceeded.');
			blocks.push({ start: position, offset, end: blockEnd, kind, children: scan(offset + 2, blockEnd, depth + 1) });
			position = blockEnd;
		}
		return blocks;
	};
	const blocks = scan(20, bytes.length, 0);
	const info = blocks.find(block => block.start === 0x1f);
	let version: number;
	if (info?.kind === 0x0003) version = reader.uint(reader.string(info.offset + 3, info.end).next + 4, 4, info.end);
	else if (info?.kind === 0x2067) version = reader.uint(info.offset + 20, 4, info.end) + 2;
	else if (info) throw new SyntaxError('Unrecognized Pro Tools version record.');
	else version = bytes[0x40] || bytes[0x3d] || bytes[0x3a]! + 2;
	if (version < 5 || version > 12) throw new RangeError(`Unsupported Pro Tools session format version ${version}.`);
	return { reader, version, blocks };
}

export function proToolsChildren(block: ProToolsBlock, kind: number): readonly ProToolsBlock[] {
	return block.children.filter(child => child.kind === kind);
}
