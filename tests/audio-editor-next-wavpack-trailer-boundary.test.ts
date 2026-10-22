/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { loadWavPackWasm } from '../src/common/editor/wavpack/runtime.js';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import { withWavPackTotalFrames } from './helpers/wavpack-import-fixture.ts';

test('File Open does not mistake a retained WavPack RIFF trailer for an external ID3v1 tag', async () => {
	const pcm = new Float32Array(4800).fill(0.25);
	const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer),
		frameCount: pcm.length, channelCount: 1, sampleRate: 48_000, settings: { compressionLevel: 2 }, maximumOutputBytes: 1024 ** 2,
	}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
	// WavPack pack_utils.c writes preserved RIFF tails in zero-sample blocks.
	const wrapper = new Uint8Array(164);
	wrapper.set(encoded.subarray(0, 10));
	new DataView(wrapper.buffer).setUint32(4, wrapper.length - 8, true);
	wrapper.set([0x22, 65], 32); // ID_RIFF_TRAILER, 130 opaque wrapper bytes.
	const trailer = withWavPackTotalFrames(wrapper, pcm.length); // Includes the reviewed block checksum.
	trailer.set(new TextEncoder().encode('TAG'), trailer.length - 128);
	const checkedTrailer = withWavPackTotalFrames(trailer, pcm.length);
	const original = new Uint8Array(encoded.length + checkedTrailer.length);
	original.set(encoded); original.set(checkedTrailer, encoded.length);
	const runtime = await loadWavPackWasm(await readFile(new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url)));
	// The complete file is accepted by the authenticated native codec itself.
	assert.deepEqual(new Float32Array(runtime.decode(original, { frames: pcm.length, channelCount: 1, sampleRate: 48_000 })), pcm);
	const { store } = await createTwoTrackFixture('next-wv-tag-boundary', new Map<string, Float32Array>(), 48_000);
	const codec = { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true,
		async decode(file: Blob) { return { channels: [new Float32Array(runtime.decode(await file.arrayBuffer(), {
			frames: pcm.length, channelCount: 1, sampleRate: 48_000,
		}))], sampleRate: 48_000 }; }, dispose() {},
	};
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en',
		store, engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: codec as unknown as Options['ffmpeg'] });
	try {
		await controller.ready;
		await controller.actions.project.importFiles([new File([original], 'Retained-wrapper.wv', { type: 'audio/wavpack' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(project && Array.isArray(project.sources));
		const sources: readonly unknown[] = project.sources;
		assert.equal(sources.length, 1, 'a valid opaque wrapper must not truncate the admitted audio container');
		const source = sources[0];
		assert.ok(source && typeof source === 'object' && 'id' in source && typeof source.id === 'string');
		assert.deepEqual(await storedChannel(store, source.id, 0), pcm);
	} finally { await controller.dispose(); }
});
