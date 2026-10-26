/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortableRead } from './abort-race.ts';
import { createVideoTimingDemuxReader } from './video-timing-demux-reader.ts';

const SEGMENT = 0x18538067, CLUSTER = 0x1f43b675, BLOCK_GROUP = 0xa0;
const SEGMENT_CHILDREN = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, CLUSTER, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367]);
interface Element { readonly id: number; readonly body: number; readonly end: number; readonly unknown: boolean }
interface Block { readonly selected: boolean; readonly laced: boolean; readonly packet: Uint8Array }
interface FinalBlock { readonly block: Block; readonly padding: bigint | null; readonly invalid: boolean }

/** Retain the established Opus decoder's pre-skip and remove only a proven final packet's end padding. */
export async function readMatroskaOpusEndPadding(file: Blob, trackId: number, signal?: AbortSignal): Promise<number> {
	const reader = createVideoTimingDemuxReader(file, { signal, maximumTotalBytes: 16 * 1024 ** 2 });
	let headers = 0;
	const read = (offset: number, length: number): Promise<Uint8Array> => raceAbortableRead(() => reader.readAtMost(offset, length), signal);
	const signature = await read(0, 4);
	if (signature.length !== 4 || signature.some((byte, index) => byte !== [0x1a, 0x45, 0xdf, 0xa3][index])) return 0;
	async function header(offset: number, end: number): Promise<Element> {
		if (++headers > 500_000) throw new RangeError('The Matroska audio padding index exceeds its header bound.');
		const bytes = await read(offset, Math.min(16, end - offset));
		const id = vint(bytes, 0, true), size = vint(bytes, id.width, false);
		const body = offset + id.width + size.width;
		const unknown = size.value === (1n << BigInt(size.width * 7)) - 1n;
		const declaredEnd = unknown ? end : body + Number(size.value);
		if (!Number.isSafeInteger(declaredEnd) || declaredEnd > end || declaredEnd < body) throw new RangeError('The Matroska audio padding index is truncated.');
		return { id: Number(id.value), body, end: declaredEnd, unknown };
	}
	async function block(element: Element): Promise<Block> {
		const bytes = await read(element.body, Math.min(13, element.end - element.body));
		const track = vint(bytes, 0, false);
		if (track.width + 3 > bytes.length) throw new RangeError('The Matroska audio block header is truncated.');
		return { selected: track.value === BigInt(trackId), laced: Boolean(bytes[track.width + 2]! & 6), packet: bytes.subarray(track.width + 3) };
	}
	async function group(element: Element): Promise<FinalBlock | null> {
		if (element.unknown) throw new RangeError('An unknown-size audio BlockGroup is not supported.');
		let candidate: Block | null = null, padding: bigint | null = null, invalid = false;
		for (let offset = element.body; offset < element.end;) {
			const child = await header(offset, element.end);
			if (child.unknown) throw new RangeError('The Matroska audio padding element has unknown size.');
			if (child.id === 0xa1) {
				if (candidate) invalid = true;
				candidate = await block(child);
			} else if (child.id === 0x75a2) {
				const length = child.end - child.body;
				if (padding !== null || length < 1 || length > 8) invalid = true;
				else {
					const bytes = await read(child.body, length);
					padding = unsigned(bytes, 0, length);
					if (bytes[0]! & 128) padding -= 1n << BigInt(length * 8);
				}
			}
			offset = child.end;
		}
		return candidate?.selected ? { block: candidate, padding, invalid } : null;
	}
	let final: FinalBlock | null = null;
	async function cluster(element: Element): Promise<number> {
		let offset = element.body;
		while (offset < element.end) {
			const child = await header(offset, element.end);
			if (element.unknown && SEGMENT_CHILDREN.has(child.id)) return offset;
			if (child.id === 0xa3) {
				const candidate = await block(child);
				if (candidate.selected) final = { block: candidate, padding: null, invalid: false };
			} else if (child.id === BLOCK_GROUP) {
				const candidate = await group(child);
				if (candidate) final = candidate;
			}
			if (child.unknown) throw new RangeError('An audio cluster child has unknown size.');
			offset = child.end;
		}
		return offset;
	}
	for (let offset = 0; offset < file.size;) {
		const element = await header(offset, file.size);
		if (element.id === SEGMENT) {
			for (let childOffset = element.body; childOffset < element.end;) {
				const child = await header(childOffset, element.end);
				if (child.id === CLUSTER) childOffset = await cluster(child);
				else {
					if (child.unknown) throw new RangeError('A Matroska segment child has unknown size.');
					childOffset = child.end;
				}
			}
			break;
		}
		if (element.unknown) return 0;
		offset = element.end;
	}
	return paddingFrames(final);
}

function paddingFrames(final: FinalBlock | null): number {
	if (!final) return 0;
	if (final.invalid) throw new RangeError('The final Matroska audio padding is malformed.');
	if (final.padding === null || final.padding <= 0n || final.block.laced) return 0;
	const bytes = final.block.packet;
	if (!bytes.length) throw new RangeError('The final Opus packet is empty.');
	const config = bytes[0]! >>> 3, code = bytes[0]! & 3;
	const samples = config >= 16 ? 120 * 2 ** (config & 3)
		: config >= 12 ? 480 * 2 ** (config & 1) : [480, 960, 1920, 2880][config & 3]!;
	if (code === 3 && bytes.length < 2) throw new RangeError('The final Opus packet frame count is missing.');
	const count = code === 0 ? 1 : code < 3 ? 2 : bytes[1]! & 63;
	const frames = samples * count;
	if (count === 0 || frames > 5760 || final.padding * 48_000n > BigInt(frames) * 1_000_000_000n) {
		throw new RangeError('The final Matroska padding exceeds its Opus packet.');
	}
	return Math.round(Number(final.padding) * 48_000 / 1_000_000_000);
}

function unsigned(bytes: Uint8Array, start: number, length: number): bigint {
	let value = 0n;
	for (let index = start; index < start + length; index++) value = value * 256n + BigInt(bytes[index]!);
	return value;
}

function vint(bytes: Uint8Array, start: number, retainMarker: boolean): Readonly<{ value: bigint; width: number }> {
	const first = bytes[start];
	if (first === undefined || first === 0) throw new RangeError('The Matroska audio padding header is invalid.');
	let width = 1;
	while (!(first & (1 << (8 - width)))) width++;
	if (width > (retainMarker ? 4 : 8) || start + width > bytes.length) throw new RangeError('The Matroska audio padding header is truncated.');
	const value = unsigned(bytes, start, width);
	return { width, value: retainMarker ? value : value & ((1n << BigInt(width * 7)) - 1n) };
}
