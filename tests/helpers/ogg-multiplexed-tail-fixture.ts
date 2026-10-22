/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { oggPageCrc } from '../../src/common/editor/ogg-page-crc.ts';

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
