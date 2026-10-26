/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { createRiffId3Chunk } from '../src/common/editor/id3-metadata.js';
import { createDesktopSelectedRangeBlob, retireDesktopSelectedRangeBlob, type DesktopSelectedRangeDescriptor } from '../src/common/editor/desktop-selected-range-blob.ts';
import { nativeOriginalImportFixture } from './helpers/native-original-import-fixture.ts';
import { riffMetadataReadView } from '../src/common/editor/riff-metadata-read-view.ts';

// Actual FFmpeg 5.1.4 / @ffmpeg/core 0.12.10 outputs. Input: 4800 mono samples,
// sin(i*.1)*.2, 48 kHz s16 WAV (dither:false). Encode with adpcm_ima_wav,
// libmp3lame, or pcm_s16le and title/artist metadata. Headers are unmodified.
function recording(codec: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(Buffer.from(readFileSync(new URL(`./fixtures/ffmpeg-${codec}-info.wav.base64`, import.meta.url), 'utf8').trim(), 'base64'));
}

for (const codec of ['ima', 'mp3', 'pcm']) test(`${codec} WAV retains independent RIFF credits`, async () => {
	const bytes = recording(codec);
	const inspected = await inspectImportedMediaMetadata(new Blob([bytes]));
	assert.equal(inspected.metadata.normalized?.title, 'Harbour voices');
	assert.equal(inspected.metadata.normalized?.artist, 'Elodie field recording');
	assert.equal(inspected.metadata.raw?.ISFT, 'Lavf59.27.100');
	assert.deepEqual(inspected.warnings, []);
});

test('compressed WAV metadata preserves independent ID3 and skips encoded audio', async () => {
	const bytes = recording('mp3');
	const id3 = createRiffId3Chunk({ composer: 'Independent composer' });
	const input = new Uint8Array(bytes.length + id3.length); input.set(bytes); input.set(id3, bytes.length);
	new DataView(input.buffer).setUint32(4, input.length - 8, true);
	let offset = 12;
	while (new TextDecoder().decode(input.subarray(offset, offset + 4)) !== 'data') {
		const size = new DataView(input.buffer).getUint32(offset + 4, true); offset += 8 + size + size % 2;
	}
	const audioStart = offset + 8;
	const audioEnd = audioStart + new DataView(input.buffer).getUint32(offset + 4, true);
	const reads: Array<readonly [number, number]> = [];
	class TrackedFile extends File {
		override slice(start = 0, end = this.size, type?: string): Blob {
			reads.push([start, end]); return super.slice(start, end, type);
		}
	}
	const inspected = await inspectImportedMediaMetadata(new TrackedFile([input], 'compressed.wav'));
	assert.equal(inspected.metadata.normalized?.title, 'Harbour voices');
	assert.equal(inspected.metadata.raw?.TCOM, 'Independent composer');
	assert.deepEqual(inspected.warnings, []);
	assert.ok(reads.every(([start, end]) => end <= audioStart || start >= audioEnd));
});

test('compressed WAV metadata does not relax RIFF bounds or cancellation', async () => {
	const bytes = recording('mp3'); new DataView(bytes.buffer).setUint32(4, bytes.length, true);
	const invalid = await inspectImportedMediaMetadata(new Blob([bytes]));
	assert.deepEqual(invalid.metadata, {});
	assert.match(invalid.warnings[0]!, /container size is invalid/);
	const abort = new AbortController(); abort.abort();
	await assert.rejects(inspectImportedMediaMetadata(new Blob([recording('mp3')]), { signal: abort.signal }), { name: 'AbortError' });
});

for (const codec of ['pcm', 'mp3']) test(`native selected-range ${codec} metadata retains real payload bytes`, async () => {
	const file = new File([recording(codec)], `${codec}.wav`, { type: 'audio/wav' });
	const native = await nativeOriginalImportFixture(file);
	const choices = await native.bridge.chooseFiles({ purpose: 'audio', multiple: false }); assert.ok(Array.isArray(choices));
	const selected = createDesktopSelectedRangeBlob(choices[0] as DesktopSelectedRangeDescriptor, { fetch: native.fetch });
	try {
		const view = await riffMetadataReadView(selected, new Uint8Array(await selected.slice(0, 12).arrayBuffer()));
		assert.ok(view);
		const header = new DataView(await view.slice(0, 12).arrayBuffer());
		assert.equal(view.size, header.getUint32(4, true) + 8, 'metadata carrier must own every declared byte');
		assert.ok(Buffer.from(await view.arrayBuffer()).includes(Buffer.from('Harbour voices')), 'carrier must retain the selected metadata bytes');
		const inspected = await inspectImportedMediaMetadata(selected);
		assert.equal(inspected.metadata.normalized?.title, 'Harbour voices');
		assert.equal(inspected.metadata.normalized?.artist, 'Elodie field recording');
		assert.deepEqual(inspected.warnings, []);
	} finally { retireDesktopSelectedRangeBlob(selected); await native.close(); }
});
