/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { metadataBytes, vorbisCommentBytes } from '../../src/common/editor/audio-metadata-values.ts';
import { oggPageCrc } from '../../src/common/editor/ogg-page-crc.ts';

/** Separate, repeated records are the Xiph-recommended representation of multiple performers. */
export async function repeatedVorbisCommentsFixture(format: 'flac' | 'ogg-vorbis' | 'opus', repeated = true): Promise<File> {
	const pcm = Float32Array.from({ length: 4800 }, (_, frame) => Math.sin(frame * .04) * .15);
	const encoded = await encodeDedicatedAudioPcm({ format, input: new Uint8Array(pcm.buffer),
		frameCount: pcm.length, sampleRate: 48_000, channelCount: 1, maximumOutputBytes: 1024 ** 2,
		settings: format === 'flac' ? { compressionLevel: 5 } : format === 'opus' ? { bitrateKbps: 128, vbrMode: 0 } : { quality: 4 } },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	const comments = vorbisCommentBytes(['TITLE=Ensemble', 'ARTIST=Ada',
		...(repeated ? ['artist=Grace', 'ARTIST=Ada', 'PERFORMER=First chair', 'performer=Second chair'] : []),
		'TRACKNUMBER=2', 'TRACKNUMBER=4', 'COMMENT=After credits']);
	let body: Uint8Array<ArrayBuffer>;
	if (format === 'flac') {
		let offset = 4, last = false;
		const parts: Uint8Array[] = [encoded.subarray(0, 4)];
		while (!last) {
			const length = encoded[offset + 1]! * 65536 + encoded[offset + 2]! * 256 + encoded[offset + 3]!;
			last = Boolean(encoded[offset]! & 128);
			if ((encoded[offset]! & 127) !== 4) {
				const block = Uint8Array.from(encoded.subarray(offset, offset + 4 + length));
				block[0] = block[0]! & 127; parts.push(block);
			}
			offset += 4 + length;
		}
		body = metadataBytes(...parts, Uint8Array.of(132, comments.length >>> 16, comments.length >>> 8, comments.length), comments, encoded.subarray(offset));
	} else {
		const firstLaces = encoded[26]!;
		let offset = 27 + firstLaces;
		for (let index = 0; index < firstLaces; index++) offset += encoded[27 + index]!;
		const laceCount = encoded[offset + 26]!;
		let oldPacketLength = 0, packetLaces = 0;
		while (packetLaces < laceCount) {
			const lace = encoded[offset + 27 + packetLaces++]!;
			oldPacketLength += lace; if (lace < 255) break;
		}
		const prefix = new TextEncoder().encode(format === 'opus' ? 'OpusTags' : '\u0003vorbis');
		const packet = metadataBytes(prefix, comments, ...(format === 'opus' ? [] : [Uint8Array.of(1)]));
		assert.ok(packet.length < 255);
		const oldBodyStart = offset + 27 + laceCount;
		let pageLength = 27 + laceCount;
		for (let index = 0; index < laceCount; index++) pageLength += encoded[offset + 27 + index]!;
		const header = Uint8Array.from(encoded.subarray(offset, offset + 27)); header[26] = 1 + laceCount - packetLaces;
		const page = metadataBytes(header, Uint8Array.of(packet.length), encoded.subarray(offset + 27 + packetLaces, oldBodyStart),
			packet, encoded.subarray(oldBodyStart + oldPacketLength, offset + pageLength));
		new DataView(page.buffer).setUint32(22, oggPageCrc(page), true);
		body = metadataBytes(encoded.subarray(0, offset), page, encoded.subarray(offset + pageLength));
	}
	return new File([body], `Ensemble.${format === 'flac' ? 'flac' : 'ogg'}`, { type: format === 'flac' ? 'audio/flac' : 'audio/ogg' });
}
