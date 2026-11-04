/* SPDX-License-Identifier: AGPL-3.0-only */
import { oggPageCrc } from '../../src/common/editor/ogg-page-crc.ts';
import { vorbisTimestampFixture } from './vorbis-timestamp-fixture.ts';

/** Preserve encoded audio and the final trim while removing early page clocks. */
export async function vorbisMissingGranuleFixture(absolute = false, missingAudioPages = Infinity): Promise<File> {
	const bytes = new Uint8Array(await vorbisTimestampFixture(absolute).arrayBuffer());
	let metadataPackets = 3;
	for (let offset = 0; offset < bytes.length;) {
		const laces = bytes.subarray(offset + 27, offset + 27 + bytes[offset + 26]!);
		const size = 27 + laces.length + laces.reduce((sum, length) => sum + length, 0);
		if (metadataPackets) metadataPackets -= laces.filter(length => length < 255).length;
		else if (!(bytes[offset + 5]! & 4) && missingAudioPages-- > 0) {
			const page = bytes.subarray(offset, offset + size), view = new DataView(page.buffer, page.byteOffset, page.byteLength);
			view.setBigInt64(6, -1n, true);
			view.setUint32(22, oggPageCrc(page), true);
		}
		offset += size;
	}
	return new File([bytes], 'Missing page clocks.ogg', { type: 'audio/ogg' });
}
