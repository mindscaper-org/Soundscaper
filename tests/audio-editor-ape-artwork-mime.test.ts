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
test('File Open retains the actual format of native APEv2 cover art', async () => {
    const pcm = Float32Array.from({ length: 4800 }, (_, index) => Math.sin(index * 0.1) * 0.2);
    const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer),
        frameCount: pcm.length, sampleRate: 48000, channelCount: 1, settings: { compressionLevel: 2 }, maximumOutputBytes: 1024 ** 2 }, dependencies);
    // Unmodified libwavpack AppendBinaryTagItem/WriteTag output: one binary GIF cover.
    const tag = Uint8Array.from([65, 80, 69, 84, 65, 71, 69, 88, 208, 7, 0, 0, 110, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 160, 0, 0, 0, 0, 0, 0, 0, 0, 52, 0, 0, 0, 2, 0, 0, 0, 67, 111, 118, 101, 114, 32, 65, 114, 116, 32, 40, 70, 114, 111, 110, 116, 41, 0, 99, 111, 118, 101, 114, 46, 103, 105, 102, 0, 71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 68, 0, 59, 65, 80, 69, 84, 65, 71, 69, 88, 208, 7, 0, 0, 110, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0]);
    const original = new File([withWavPackTotalFrames(encoded, pcm.length), tag], 'GIF cover.wv', { type: 'audio/wavpack' });
    const { store } = await createTwoTrackFixture('gif-cover', new Map<string, Float32Array>(), 48000);
    const codec = { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true,
        async decode(file: Blob) {
            const decoded = await decodeDedicatedAudioFile({ format: 'wavpack', input: new Uint8Array(await file.arrayBuffer()), maximumOutputBytes: 1024 ** 2 }, dependencies);
            const data = new DataView(decoded.interleaved.buffer);
            return { sampleRate: decoded.sampleRate, channels: Array.from({ length: decoded.channelCount }, (_, channel) => Float32Array.from({ length: decoded.frameCount }, (_, frame) => data.getFloat32((frame * decoded.channelCount + channel) * 4, true))) };
        }, dispose() { },
    };
    type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
    const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en',
        store, engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: codec as unknown as Options['ffmpeg'] });
    try {
        await controller.ready;
        await controller.actions.project.importFiles([original], { destination: 'timeline' });
        const project = controller.getSnapshot().project;
        assert.ok(project && Array.isArray(project.sources));
        const sources: readonly unknown[] = project.sources;
        assert.equal(sources.length, 1);
        const source = sources[0];
        assert.ok(source && typeof source === 'object' && 'provenance' in source && 'id' in source && typeof source.id === 'string');
        assert.equal(await storedSample(store, source.id, 1), Math.fround(Math.sin(.1) * .2));
        const contribution = normalizeSourceProvenance(source.provenance, 'imported source').contributions[0];
        assert.equal(contribution?.attachments.find(attachment => attachment.path === 'images[0]')?.mimeType, 'image/gif');
        assert.deepEqual(contribution?.warnings, []);
    }
    finally {
        await controller.dispose();
    }
});
