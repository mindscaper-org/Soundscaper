/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { createRiffId3Chunk } from '../src/common/editor/id3-metadata.js';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createDesktopAudioRangeBlob, retireDesktopAudioRangeBlob } from '../src/common/editor/desktop-audio-range-blob.ts';
import { riffMetadataReadView } from '../src/common/editor/riff-metadata-read-view.ts';
import { libsndfileRifxSamples } from './helpers/libsndfile-rifx-fixture.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';

test('independent RIFF metadata view omits INFO while retaining owned ID3 bytes', async () => {
	const info = new Uint8Array(22);
	info.set(new TextEncoder().encode('LIST'));
	new DataView(info.buffer).setUint32(4, 14, true);
	info.set(new TextEncoder().encode('INFOINAM'), 8);
	new DataView(info.buffer).setUint32(16, 1, true);
	const bytes = encodeWav([new Float32Array(4800)], { sampleRate: 48_000, bitDepth: 16, dither: false,
		preDataChunks: [info, createRiffId3Chunk({ title: 'Recorded credit' })] });
	const view = await riffMetadataReadView(new Blob([Uint8Array.from(bytes)]), bytes.subarray(0, 12), undefined, { omitInfo: true });
	assert.ok(view);
	const owned = new Uint8Array(await view.arrayBuffer());
	assert.equal(view.size, new DataView(owned.buffer).getUint32(4, true) + 8);
	assert.equal(Buffer.from(owned).includes(Buffer.from('INFOINAM')), false);
	assert.ok(Buffer.from(owned).includes(Buffer.from('Recorded credit')));
});

test('independent RIFX metadata view retains ID3 with normalized outer chunk sizes', async () => {
	const pcm = libsndfileRifxSamples('s16');
	const info = new Uint8Array(22);
	info.set(new TextEncoder().encode('LIST'));
	new DataView(info.buffer).setUint32(4, 14, false);
	info.set(new TextEncoder().encode('INFOINAM'), 8);
	new DataView(info.buffer).setUint32(16, 1, false);
	const id3 = createRiffId3Chunk({ title: 'Recorded credit' });
	const id3Size = new DataView(id3.buffer, id3.byteOffset, id3.byteLength).getUint32(4, true);
	new DataView(id3.buffer, id3.byteOffset, id3.byteLength).setUint32(4, id3Size, false);
	const bytes = new Uint8Array(pcm.length + info.length + id3.length);
	bytes.set(pcm); bytes.set(info, pcm.length); bytes.set(id3, pcm.length + info.length);
	new DataView(bytes.buffer).setUint32(4, bytes.length - 8, false);
	const file = new Blob([bytes]);
	const prepared = await prepareStreamedAudioImport(file);
	try { assert.equal(prepared.descriptor.frameCount, 4); } finally { prepared.dispose(); }
	const view = await riffMetadataReadView(file, bytes.subarray(0, 12), undefined, { omitInfo: true });
	assert.ok(view);
	const inspected = await inspectImportedMediaMetadata(view);
	assert.deepEqual(inspected.warnings, []);
	assert.equal(inspected.metadata.normalized?.title, 'Recorded credit');
});

test('desktop range WAVE import retains ID3 credits behind blank INFO without reading PCM', async () => {
	for (const [id, key, normalized] of [['INAM', 'title', 'title'], ['IART', 'artist', 'artist'], ['ICMT', 'comments', 'comment']] as const) {
		const info = new Uint8Array(22);
		info.set(new TextEncoder().encode('LIST'));
		new DataView(info.buffer).setUint32(4, 14, true);
		info.set(new TextEncoder().encode(`INFO${id}`), 8);
		new DataView(info.buffer).setUint32(16, 1, true);
		const id3 = createRiffId3Chunk({ [key]: 'Recorded credit' });
		const bytes = encodeWav([new Float32Array(4800)], { sampleRate: 48_000, bitDepth: 16,
			dither: false, preDataChunks: [info, id3] });
		const audioStart = bytes.length - 9600;
		const reads: Array<readonly [number, number]> = [];
		const readId = 'c'.repeat(64);
		const file = createDesktopAudioRangeBlob({ id: readId, name: 'Recording.wav', size: bytes.length,
			mimeType: 'audio/wav', readProfile: 'linked-audio-range-v1', lastModified: 0,
			url: `soundscaper-app://bundle/_desktop/read/linked-audio-range-v1/${readId}/Recording.wav`,
		}, { fetch: async (_url, init) => {
			const match = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('Range')!);
			assert.ok(match);
			const start = Number(match[1]); const end = Number(match[2]);
			reads.push([start, end + 1]);
			return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
				'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
				'Content-Length': String(end - start + 1), 'Content-Type': 'audio/wav',
			} });
		} });
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const abort = new AbortController();
		try {
			assert.equal((await inspectWavBlobPcm(file))?.frameCount, 4800);
			reads.length = 0;
			const inspected = await Promise.race([
				inspectImportedMediaMetadata(file, { signal: abort.signal }),
				new Promise<never>((_resolve, reject) => {
					deadline = setTimeout(() => { reject(new Error('Desktop metadata import stalled.')); abort.abort(); }, 2000);
				}),
			]);
			assert.deepEqual(inspected.warnings, []);
			assert.equal(inspected.metadata.normalized?.[normalized], 'Recorded credit');
			assert.equal(inspected.metadata.raw?.[id], '');
			assert.ok(reads.every(([, end]) => end <= audioStart), 'metadata inspection must never materialize PCM');
		} finally {
			clearTimeout(deadline); abort.abort(); retireDesktopAudioRangeBlob(file);
		}
	}
});
