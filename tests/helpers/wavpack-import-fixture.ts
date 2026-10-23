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

/** APEv2 text items carry several values inside one NUL-separated item. */
export async function createMultiValueWavPackFixture(): Promise<File> {
	const { createApeFileMetadata } = await import('../../src/common/editor/ape-file-metadata.ts');
	return new File([await createAudacityWavPackFixture(4800), createApeFileMetadata({
		title: 'Two credited performers', artist: 'Ada\0Béla', comment: 'First note\0Second note',
		track: '3\0Alternate track', date: '2026-10-23\u00002025', Custom: 'One\0Two',
	})], 'Multiple performers.wv', { type: 'audio/wavpack' });
}

/** APEv2 external-reference items contain UTF-8 locators, rather than binary attachments. */
export async function createReferenceWavPackFixture(type: 0 | 1 | 2, key = 'Related'): Promise<File> {
	const { createApeFileMetadata } = await import('../../src/common/editor/ape-file-metadata.ts');
	const tag = createApeFileMetadata({ [key]: 'https://example.org/credits/Éva', title: 'Referenced performance', year: '2026' });
	const keyBytes = new TextEncoder().encode(`${key.toUpperCase()}\0`);
	const position = Buffer.from(tag).indexOf(keyBytes); if (position < 8) throw new Error('The APE fixture key was not encoded.');
	new DataView(tag.buffer).setUint32(position - 4, type << 1, true);
	return new File([await createAudacityWavPackFixture(4800), tag], 'Referenced performance.wv', { type: 'audio/wavpack' });
}

/** Legal APEv2 records can exceed the editor's optional metadata inspection budget. */
export async function createMetadataBudgetWavPackFixture(mode: 'control' | 'fields' | 'bytes'): Promise<File> {
	const { createApeFileMetadata } = await import('../../src/common/editor/ape-file-metadata.ts');
	const entries = mode === 'bytes' ? { Archive: 'x'.repeat(17 * 1024 ** 2) }
		: Object.fromEntries(Array.from({ length: mode === 'fields' ? 257 : 256 }, (_, index) => [`Field${String(index)}`, `Credit ${String(index)}`]));
	return new File([await createAudacityWavPackFixture(4800), createApeFileMetadata(entries)], `Metadata ${mode}.wv`, { type: 'audio/wavpack' });
}
