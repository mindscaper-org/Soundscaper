/* SPDX-License-Identifier: AGPL-3.0-only */

import { selectedRangeDescriptorForBlob } from './desktop-selected-range-blob.ts';
import { demuxMatroskaVideoTiming } from './video-timing-demux-matroska.ts';
import { bigEndianUnsigned, createVideoTimingDemuxReader, throwIfAborted,
	type VideoTimingDemuxReader, type VideoTimingDemuxReaderOptions } from './video-timing-demux-reader.ts';

interface Element {
	readonly id: number; readonly offset: number; readonly body: number; readonly end: number;
	readonly sizeOffset: number; readonly sizeWidth: number; readonly unknown: boolean;
}
interface Integer { readonly value: bigint; readonly width: number; }
interface Profile { readonly info: Element; readonly origin: bigint; }
const SEGMENT = 0x1853_8067, INFO = 0x1549_a966, CLUSTER = 0x1f43_b675;

/** A decoder-only view: original storage, capabilities and encoded packets remain unchanged. */
export async function prepareVideoWebmDecoderSource(
	input: Blob,
	options: VideoTimingDemuxReaderOptions = {},
): Promise<Blob> {
	throwIfAborted(options.signal);
	if (!isWebm(input) || selectedRangeDescriptorForBlob(input)) return input;
	// Blob subclasses can expose remote bytes while their native Blob body is empty.
	// Compose only a real, equally sized native body; never concatenate virtual slices.
	const source = new Blob([input], { type: input.type });
	if (source.size !== input.size) return input;
	const reader = createVideoTimingDemuxReader(source, options);
	const profile = await liveProfile(reader);
	if (!profile) return input;
	const timing = await demuxMatroskaVideoTiming(reader, options);
	throwIfAborted(options.signal);
	if (!timing) return input;
	const end = profile.origin + timing.presentationTicks.at(-1)! + timing.finalFrameDurationTicks;
	if (end <= 0n || end > BigInt(Number.MAX_SAFE_INTEGER)) return input;
	// The strict demux timescale is the inverse of the container's TimecodeScale.
	const duration = Number(end);
	const encodedDuration = new Uint8Array(11);
	encodedDuration.set([0x44, 0x89, 0x88]);
	new DataView(encodedDuration.buffer).setFloat64(3, duration);
	const { info } = profile;
	const size = encodeSize(info.end - info.body + encodedDuration.length, info.sizeWidth);
	return new Blob([source.slice(0, info.sizeOffset), size, source.slice(info.body, info.end),
		encodedDuration, source.slice(info.end)], { type: input.type });
}

function isWebm(input: Blob): boolean {
	return /^(?:video|audio)\/webm(?:;|$)/iu.test(input.type)
		|| ('name' in input && typeof input.name === 'string' && /\.webm$/iu.test(input.name));
}

async function liveProfile(reader: VideoTimingDemuxReader): Promise<Profile | null> {
	const ebml = await element(reader, 0, reader.byteLength);
	if (!ebml || ebml.id !== 0x1a45_dfa3 || ebml.unknown || !await webmDocType(reader, ebml)) return null;
	const segment = await element(reader, ebml.end, reader.byteLength);
	if (!segment || segment.id !== SEGMENT || !segment.unknown) return null;
	let info: Element | null = null, videoTrack: bigint | null = null, origin: bigint | null = null;
	let timestamp = 0n, offset = segment.body;
	while (offset < segment.end) {
		const child = await element(reader, offset, segment.end);
		if (!child) return null;
		// Moving byte offsets would invalidate these indices or checksum scopes.
		if ([0x114d_9b74, 0x1c53_bb6b, 0xbf, 0xa7, SEGMENT].includes(child.id)) return null;
		// A sized Cluster can hide a Position or CRC that this live forward walk does not inspect.
		if (child.id === CLUSTER && !child.unknown) return null;
		if (child.id === INFO) {
			if (info || child.unknown || !await absentDuration(reader, child)) return null;
			info = child;
		} else if (child.id === 0x1654_ae6b) {
			if (child.unknown || videoTrack !== null) return null;
			videoTrack = await firstVideoTrack(reader, child);
		} else if (child.id === 0xe7) {
			if (child.unknown || child.end - child.body > 8) return null;
			timestamp = bigEndianUnsigned(await reader.read(child.body, child.end - child.body), 0, child.end - child.body);
		} else if (videoTrack !== null && (child.id === 0xa3 || child.id === 0xa0)) {
			const block = await firstBlockTime(reader, child, videoTrack);
			if (block?.laced) return null;
			if (block) {
				const absolute = timestamp + block.relative;
				if (origin === null || absolute < origin) origin = absolute;
			}
		}
		if (child.unknown) {
			if (child.id !== CLUSTER) return null;
			offset = child.body;
		} else offset = child.end;
	}
	return info && origin !== null ? { info, origin } : null;
}

async function webmDocType(reader: VideoTimingDemuxReader, parent: Element): Promise<boolean> {
	let offset = parent.body;
	while (offset < parent.end) {
		const child = await element(reader, offset, parent.end);
		if (!child || child.unknown) return false;
		if (child.id === 0x4282) {
			if (child.end - child.body !== 4) return false;
			const bytes = await reader.read(child.body, 4);
			return bytes.every((byte, index) => byte === [0x77, 0x65, 0x62, 0x6d][index]);
		}
		offset = child.end;
	}
	return false;
}

async function absentDuration(reader: VideoTimingDemuxReader, parent: Element): Promise<boolean> {
	let offset = parent.body;
	while (offset < parent.end) {
		const child = await element(reader, offset, parent.end);
		if (!child || child.unknown || child.id === 0x4489 || child.id === 0xbf) return false;
		offset = child.end;
	}
	return true;
}

async function firstVideoTrack(reader: VideoTimingDemuxReader, parent: Element): Promise<bigint | null> {
	let offset = parent.body;
	while (offset < parent.end) {
		const entry = await element(reader, offset, parent.end);
		if (!entry || entry.unknown) return null;
		if (entry.id === 0xae) {
			let position = entry.body, number: bigint | null = null, type: bigint | null = null;
			while (position < entry.end) {
				const field = await element(reader, position, entry.end);
				if (!field || field.unknown) return null;
				if (field.id === 0xd7 || field.id === 0x83) {
					const length = field.end - field.body;
					if (length < 1 || length > 8) return null;
					const value = bigEndianUnsigned(await reader.read(field.body, length), 0, length);
					if (field.id === 0xd7) number = value; else type = value;
				}
				position = field.end;
			}
			if (type === 1n && number !== null) return number;
		}
		offset = entry.end;
	}
	return null;
}

async function firstBlockTime(reader: VideoTimingDemuxReader, parent: Element, track: bigint): Promise<Readonly<{
	relative: bigint; laced: boolean;
}> | null> {
	if (parent.unknown) return null;
	let block = parent;
	if (parent.id === 0xa0) {
		let offset = parent.body;
		while (offset < parent.end) {
			const child = await element(reader, offset, parent.end);
			if (!child || child.unknown) return null;
			if (child.id === 0xa1) { block = child; break; }
			offset = child.end;
		}
		if (block === parent) return null;
	}
	const bytes = await reader.readAtMost(block.body, Math.min(12, block.end - block.body));
	const number = integer(bytes, 0, false);
	if (!number || number.value !== track || number.width + 3 > bytes.length) return null;
	const raw = Number(bigEndianUnsigned(bytes, number.width, number.width + 2));
	return { relative: BigInt(raw >= 0x8000 ? raw - 0x1_0000 : raw), laced: Boolean(bytes[number.width + 2]! & 6) };
}

async function element(reader: VideoTimingDemuxReader, offset: number, end: number): Promise<Element | null> {
	const bytes = await reader.readAtMost(offset, Math.min(16, end - offset));
	const id = integer(bytes, 0, true);
	if (!id || id.width > 4) return null;
	const size = integer(bytes, id.width, false);
	if (!size) return null;
	const body = offset + id.width + size.width;
	const unknown = size.value === (1n << BigInt(7 * size.width)) - 1n;
	const declaredEnd = unknown ? end : body + Number(size.value);
	if (!Number.isSafeInteger(declaredEnd) || declaredEnd < body) return null;
	if (declaredEnd > end) throw new RangeError('The WebM decoder source ended inside a declared structure.');
	return { id: Number(id.value), offset, body, end: declaredEnd,
		sizeOffset: offset + id.width, sizeWidth: size.width, unknown };
}

function integer(bytes: Uint8Array, offset: number, keepMarker: boolean): Integer | null {
	const first = bytes[offset];
	if (!first) return null;
	let width = 1;
	while (width <= 8 && !(first & 0x80 >> (width - 1))) width++;
	if (width > 8 || offset + width > bytes.length) return null;
	const value = bigEndianUnsigned(bytes, offset, offset + width);
	return { value: keepMarker ? value : value & (1n << BigInt(width * 7)) - 1n, width };
}

function encodeSize(value: number, minimumWidth: number): Uint8Array<ArrayBuffer> {
	let width = minimumWidth;
	while (width <= 8 && BigInt(value) >= (1n << BigInt(width * 7)) - 1n) width++;
	if (width > 8) throw new RangeError('The WebM decoder duration exceeds its header size.');
	let encoded = BigInt(value) | 1n << BigInt(width * 7);
	const bytes = new Uint8Array(width);
	for (let index = width - 1; index >= 0; index--) { bytes[index] = Number(encoded & 255n); encoded >>= 8n; }
	return bytes;
}
