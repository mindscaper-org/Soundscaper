/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { createRiffId3Chunk } from '../src/common/editor/id3-metadata.js';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

test('an empty WAVE INFO field cannot hide the independent ID3 credit during import', async () => {
	for (const [id, key, normalized] of [['INAM', 'title', 'title'], ['IART', 'artist', 'artist'], ['ICMT', 'comments', 'comment']] as const) {
		const pcm = encodeWav([new Float32Array(4800)], { sampleRate: 48_000, bitDepth: 16, dither: false });
		const info = new Uint8Array(22);
		info.set(new TextEncoder().encode('LIST'));
		new DataView(info.buffer).setUint32(4, 14, true);
		info.set(new TextEncoder().encode(`INFO${id}`), 8);
		new DataView(info.buffer).setUint32(16, 1, true);
		const id3 = createRiffId3Chunk({ [key]: 'Recorded credit' });
		const bytes = new Uint8Array(pcm.length + info.length + id3.length);
		bytes.set(pcm.subarray(0, 12)); bytes.set(info, 12); bytes.set(id3, 12 + info.length);
		bytes.set(pcm.subarray(12), 12 + info.length + id3.length);
		new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
		const file = new File([bytes], 'Recording.wav');
		const descriptor = await inspectWavBlobPcm(file);
		assert.equal(descriptor?.frameCount, 4800);
		const inspection = await inspectImportedMediaMetadata(file);
		assert.deepEqual(inspection.warnings, []);
		assert.equal(inspection.metadata.normalized?.[normalized], 'Recorded credit');
		assert.equal(inspection.metadata.raw?.[id], '', 'the originally blank INFO field remains available');
	}
});
