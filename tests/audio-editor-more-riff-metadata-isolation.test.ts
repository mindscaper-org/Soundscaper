/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { createRiffId3Chunk } from '../src/common/editor/id3-metadata.js';
import { createRiffInfoChunk } from '../src/common/editor/riff-info.ts';
import { encodeWav } from '../src/common/editor/wav.js';

function codePageChunk(codePage: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(16);
	bytes.set(new TextEncoder().encode('CSET'));
	new DataView(bytes.buffer).setUint32(4, 8, true);
	new DataView(bytes.buffer).setUint16(8, codePage, true);
	return bytes;
}

for (const codePage of [866, 65001]) {
	test(`unreadable RIFF INFO preserves independently encoded ID3 tags with a warning (${String(codePage)})`, async () => {
		const info = createRiffInfoChunk({ title: 'Rejected INFO title', artist: 'Rejected INFO artist' });
		if (codePage === 65001) {
			// A valid UTF-8 declaration with a corrupt first field must not hide a later valid one.
			info[20] = 0xff;
		}
		const file = new File([Uint8Array.from(encodeWav([Float32Array.of(0.25)], {
			preDataChunks: [codePageChunk(codePage), info],
			trailingChunks: [createRiffId3Chunk({ title: 'Independent ID3 title', album: 'Independent album' })],
		}))], 'metadata.wav', { type: 'audio/wav' });
		const inspected = await inspectImportedMediaMetadata(file);
		assert.equal(inspected.metadata.normalized?.title, 'Independent ID3 title');
		assert.equal(inspected.metadata.normalized?.album, 'Independent album');
		assert.equal(inspected.metadata.raw?.TIT2, 'Independent ID3 title');
		assert.equal(inspected.metadata.raw?.INAM, undefined);
		assert.equal(inspected.metadata.normalized?.artist, codePage === 65001 ? 'Rejected INFO artist' : undefined);
		assert.ok(inspected.warnings.some((warning) => /RIFF INFO INAM/u.test(warning)));
	});
}
