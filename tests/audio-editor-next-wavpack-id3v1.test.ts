/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeDedicatedAudioFile, encodeDedicatedAudioPcm, type BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, storedSample } from './helpers/audio-editor-multitrack-selection-harness.js';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { withWavPackTotalFrames } from './helpers/wavpack-import-fixture.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';

const dependencies = { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => new Uint8Array(await readFile(url)) };

for (const trackNumber of [null, 7]) test(`File Open retains a WavPack recording's legacy ID3v1${trackNumber ? '.1' : ''} metadata`, async () => {
	const pcm = new Float32Array(4800).fill(0.25);
	const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer),
		frameCount: pcm.length, sampleRate: 48_000, channelCount: 1, settings: { compressionLevel: 2 }, maximumOutputBytes: 1024 ** 2 }, dependencies);
	const tag = new Uint8Array(128);
	const write = (at: number, text: string): void => { tag.set(new TextEncoder().encode(text), at); };
	write(0, 'TAG'); write(3, 'Field caf'); tag[12] = 0xe9; write(33, 'Ada'); write(63, 'Album'); write(93, '2026'); write(97, 'The comment');
	if (trackNumber !== null) tag[126] = trackNumber;
	tag[127] = 17; // Standard ID3v1 Rock genre.
	const { store } = await createTwoTrackFixture(`next-id3v1-${String(trackNumber)}`, new Map<string, Float32Array>(), 48_000);
	const codec = { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true,
		async decode(file: Blob) {
			const decoded = await decodeDedicatedAudioFile({ format: 'wavpack', input: new Uint8Array(await file.arrayBuffer()), maximumOutputBytes: 1024 ** 2 }, dependencies);
			const data = new DataView(decoded.interleaved.buffer);
			return { sampleRate: decoded.sampleRate, channels: Array.from({ length: decoded.channelCount }, (_, channel) =>
				Float32Array.from({ length: decoded.frameCount }, (_, frame) => data.getFloat32((frame * decoded.channelCount + channel) * 4, true))) };
		}, dispose() {},
	};
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en',
		store, engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: codec as unknown as Options['ffmpeg'] });
	try {
		await controller.ready;
		await controller.actions.project.importFiles([new File([withWavPackTotalFrames(encoded, pcm.length), tag], 'Legacy.wv', { type: 'audio/wavpack' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(project && Array.isArray(project.sources));
		const sources: readonly unknown[] = project.sources;
		assert.equal(sources.length, 1);
		const source = sources[0];
		assert.ok(source && typeof source === 'object' && 'provenance' in source && 'id' in source && typeof source.id === 'string');
		assert.equal(await storedSample(store, source.id, 0), 0.25);
		const contribution = normalizeSourceProvenance(source.provenance, 'imported source').contributions[0];
		assert.deepEqual(contribution?.metadata.normalized, { title: 'Field café', artist: 'Ada', album: 'Album', date: '2026',
			comment: 'The comment', genre: 'Rock', ...(trackNumber !== null ? { trackNumber } : {}) });
		assert.deepEqual(contribution?.warnings, []);
	} finally { await controller.dispose(); }
});
