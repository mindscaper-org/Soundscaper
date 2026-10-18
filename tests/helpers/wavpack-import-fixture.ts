/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';

/** Audacity writes the known source length once, then unknown continuation totals. */
export async function createAudacityWavPackFixture(frames = 96_000): Promise<Uint8Array<ArrayBuffer>> {
	const pcm = new Float32Array(frames * 2);
	for (let frame = 0; frame < frames; frame++) {
		pcm[frame * 2] = Math.sin(frame * 0.1) * 0.2;
		pcm[frame * 2 + 1] = Math.cos(frame * 0.03) * 0.1;
	}
	const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer),
		frameCount: frames, channelCount: 2, sampleRate: 48_000, settings: { compressionLevel: 2 }, maximumOutputBytes: 2 * 1024 * 1024,
	}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
	const output = Uint8Array.from(encoded);
	let offset = 0;
	while (offset < output.length) {
		const byteLength = new DataView(output.buffer).getUint32(offset + 4, true) + 8;
		if (offset > 0) output.set(withWavPackTotalFrames(output.subarray(offset, offset + byteLength), 0xffff_ffff), offset);
		offset += byteLength;
	}
	return output;
}

/** Retain a valid block checksum after changing only the container declaration. */
export function withWavPackTotalFrames(group: Uint8Array, totalFrames: number): Uint8Array<ArrayBuffer> {
	const originalFlags = new DataView(group.buffer, group.byteOffset).getUint32(24, true);
	const output = new Uint8Array(group.length + (originalFlags & 0x1000_0000 ? 0 : 6));
	output.set(group);
	if (!(originalFlags & 0x1000_0000)) output.set([0x2f, 2, 0, 0, 0, 0], group.length);
	const view = new DataView(output.buffer);
	view.setUint32(4, output.length - 8, true);
	view.setUint32(12, totalFrames, true);
	view.setUint32(24, originalFlags | 0x1000_0000, true);
	let offset = 32;
	while (offset < output.length) {
		const start = offset;
		const id = output[offset++]!;
		let words = output[offset++]!;
		if (id & 0x80) { words += output[offset++]! << 8; words += output[offset++]! << 16; }
		const dataLength = words * 2 - ((id & 0x40) ? 1 : 0);
		if ((id & 0x3f) === 0x2f) {
			let checksum = 0xffff_ffff;
			for (let index = 0; index < start; index += 2) checksum = (Math.imul(checksum, 3) + output[index]! + (output[index + 1]! << 8)) >>> 0;
			if (dataLength === 2) checksum = (checksum ^ (checksum >>> 16)) & 0xffff;
			for (let index = 0; index < dataLength; index += 1) { output[offset + index] = checksum & 0xff; checksum >>>= 8; }
		}
		offset += words * 2;
	}
	return output;
}
