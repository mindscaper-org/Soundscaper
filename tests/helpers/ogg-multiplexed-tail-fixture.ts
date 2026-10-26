/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { oggPageCrc } from '../../src/common/editor/ogg-page-crc.ts';
import { writeFlacFileMetadata } from '../../src/common/editor/flac-file-metadata.ts';

/** Both BOS pages precede data; the second genuine audio stream ends later. */
export async function multiplexedOpusFixture(): Promise<Readonly<{
	primary: Uint8Array<ArrayBuffer>; multiplexed: Uint8Array<ArrayBuffer>; frames: number;
}>> {
	const frames = 48_001;
	const primary = await encode(frames, false);
	const first = pages(primary);
	const second = pages(await encode(48_000 * 20, true));
	for (const page of second) {
		const view = new DataView(page.buffer);
		view.setUint32(14, view.getUint32(14, true) ^ 0x12345678, true);
		view.setUint32(22, oggPageCrc(page), true);
	}
	assert.ok(second.reduce((sum, page) => sum + page.length, 0) > 2 * 65_307);
	const parts = [first[0]!, second[0]!, ...first.slice(1), ...second.slice(1)];
	const multiplexed = new Uint8Array(parts.reduce((sum, page) => sum + page.length, 0));
	let offset = 0;
	for (const page of parts) { multiplexed.set(page, offset); offset += page.length; }
	return { primary, multiplexed, frames };
}

/** Cropping/live capture may retain an absolute nonzero audio granule origin. */
export async function croppedOpusGranuleFixture(origin = 480_000): Promise<Readonly<{
	original: Uint8Array<ArrayBuffer>; cropped: Uint8Array<ArrayBuffer>; frames: number;
}>> {
	const frames = 48_001;
	const original = await encode(frames, false);
	const shifted = pages(original);
	assert.ok(shifted.some(page => !(page[5]! & 4) && new DataView(page.buffer).getBigUint64(6, true) > 0n),
		'the first audio page precedes EOS so end trimming remains independently stated');
	for (const page of shifted) {
		const view = new DataView(page.buffer);
		const granule = view.getBigUint64(6, true);
		if (granule > 0n && granule < 0xffff_ffff_ffff_ffffn) {
			view.setBigUint64(6, granule + BigInt(origin), true);
			view.setUint32(22, oggPageCrc(page), true);
		}
	}
	return { original, cropped: new Uint8Array(await new Blob(shifted).arrayBuffer()), frames };
}

/** RFC 7845 sequential links, as produced by segmented Internet-radio captures. */
export async function chainedOpusFixture(): Promise<Readonly<{
	first: Uint8Array<ArrayBuffer>; chained: Uint8Array<ArrayBuffer>; frames: number;
}>> {
	const first = await encode(48_001, false);
	const second = pages(await encode(24_001, true));
	for (const page of second) {
		const view = new DataView(page.buffer);
		view.setUint32(14, view.getUint32(14, true) ^ 0x31415926, true);
		view.setUint32(22, oggPageCrc(page), true);
	}
	return { first, chained: new Uint8Array(await new Blob([first, ...second]).arrayBuffer()), frames: 72_002 };
}

async function encode(frames: number, noise: boolean): Promise<Uint8Array<ArrayBuffer>> {
	let state = 42;
	const pcm = Float32Array.from({ length: frames }, (_, index) => noise
		? ((state = Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x80000000 * .2 - .2
		: Math.sin(index * .03) * .1);
	return encodeDedicatedAudioPcm({ format: 'opus', input: new Uint8Array(pcm.buffer), frameCount: frames,
		sampleRate: 48_000, channelCount: 1, settings: { bitrateKbps: 128, vbrMode: 0 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
}

function pages(bytes: Uint8Array): Uint8Array<ArrayBuffer>[] {
	const result: Uint8Array<ArrayBuffer>[] = [];
	for (let offset = 0; offset < bytes.length;) {
		let length = 27 + bytes[offset + 26]!;
		for (let index = 0; index < bytes[offset + 26]!; index++) length += bytes[offset + 27 + index]!;
		result.push(Uint8Array.from(bytes.subarray(offset, offset + length)));
		offset += length;
	}
	return result;
}

/** RFC9639 section10: map the maintained FLAC encoder's single real frame to Ogg. */
export async function ordinaryOggFlacFixture(tags: Readonly<Record<string, string>> = {}): Promise<File> {
	const frames = 1024;
	const pcm = Float32Array.from({ length: frames }, (_, frame) => .3 * Math.sin(2 * Math.PI * 440 * frame / 48_000));
	let encoded = await encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(pcm.buffer), frameCount: frames,
		sampleRate: 48_000, channelCount: 1, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	if (Object.keys(tags).length) encoded = new Uint8Array(await (await writeFlacFileMetadata(new Blob([encoded]), tags)).arrayBuffer());
	assert.equal(new TextDecoder().decode(encoded.subarray(0, 4)), 'fLaC');
	const metadata: Uint8Array<ArrayBuffer>[] = []; let offset = 4, last = false;
	while (!last) {
		last = Boolean(encoded[offset]! & 128);
		const length = encoded[offset + 1]! * 65536 + encoded[offset + 2]! * 256 + encoded[offset + 3]!;
		metadata.push(encoded.slice(offset, offset + 4 + length)); offset += 4 + length;
	}
	assert.equal(metadata[0]!.length, 38); assert.ok(offset < encoded.length);
	const identification = Uint8Array.of(127, 70, 76, 65, 67, 1, 0, 0, metadata.length - 1, 102, 76, 97, 67, ...metadata[0]!);
	const packets = [identification, ...metadata.slice(1), encoded.subarray(offset)];
	const output: Uint8Array<ArrayBuffer>[] = [];
	let sequence = 0;
	for (const [index, packet] of packets.entries()) {
		const laces = [...new Array<number>(Math.floor(packet.length / 255)).fill(255), packet.length % 255];
		let packetOffset = 0;
		for (let laceOffset = 0; laceOffset < laces.length; laceOffset += 255) {
			const pageLaces = laces.slice(laceOffset, laceOffset + 255), completed = laceOffset + pageLaces.length === laces.length;
			const length = pageLaces.reduce((sum, value) => sum + value, 0);
			const page = new Uint8Array(27 + pageLaces.length + length); page.set(new TextEncoder().encode('OggS'));
			page[5] = (index === 0 ? 2 : 0) | (laceOffset ? 1 : 0) | (index === packets.length - 1 && completed ? 4 : 0); page[26] = pageLaces.length;
			const view = new DataView(page.buffer); view.setBigUint64(6, !completed ? 0xffff_ffff_ffff_ffffn : index === packets.length - 1 ? BigInt(frames) : 0n, true);
			view.setUint32(14, 0x1234abcd, true); view.setUint32(18, sequence++, true); page.set(pageLaces, 27);
			page.set(packet.subarray(packetOffset, packetOffset + length), 27 + pageLaces.length); packetOffset += length;
			view.setUint32(22, oggPageCrc(page), true); output.push(page);
		}
	}
	return new File(output, 'Recorder.oga', { type: 'audio/ogg' });
}
