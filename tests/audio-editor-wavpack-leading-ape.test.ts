/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeDedicatedAudioFile, encodeDedicatedAudioPcm, type BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, storedSample } from './helpers/audio-editor-multitrack-selection-harness.js';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { createApeFileMetadata } from '../src/common/editor/ape-file-metadata.ts';
import { withWavPackTotalFrames } from './helpers/wavpack-import-fixture.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import { wavPackAudioBlob } from '../src/common/editor/ape-metadata-reader.ts';
import { readImportedMetadataTags } from '../src/common/editor/imported-metadata-reader.ts';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { createAudacityWavPackFixture } from './helpers/wavpack-import-fixture.ts';
import { createDesktopAudioRangeBlob, retireDesktopAudioRangeBlob } from '../src/common/editor/desktop-audio-range-blob.ts';
const dependencies = { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => new Uint8Array(await readFile(url)) };
for (const footer of [true, false]) test(`File Open imports leading APEv2 WavPack (footer=${String(footer)})`, async () => {
    const pcm = new Float32Array(4800).fill(0.25);
    const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer),
        frameCount: pcm.length, sampleRate: 48000, channelCount: 1, settings: { compressionLevel: 2 }, maximumOutputBytes: 1024 ** 2 }, dependencies);
    let tag = createApeFileMetadata({ title: 'Leading archived performance', artist: 'Ada' });
    if (!footer) {
        new DataView(tag.buffer).setUint32(20, 0xe000_0000, true);
        tag = tag.slice(0, -32);
    }
    const original = new File([tag, withWavPackTotalFrames(encoded, pcm.length)], 'Leading.wv', { type: 'audio/wavpack' });
    const { store } = await createTwoTrackFixture('leading-ape', new Map<string, Float32Array>(), 48000);
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
        assert.equal(await storedSample(store, source.id, 0), 0.25);
        const contribution = normalizeSourceProvenance(source.provenance, 'imported source').contributions[0];
        assert.deepEqual(contribution?.metadata.normalized, { title: 'Leading archived performance', artist: 'Ada' });
        assert.deepEqual(contribution?.warnings, []);
    }
    finally {
        await controller.dispose();
    }
});
test('leading APE metadata and audio use only bounded desktop range reads', async () => {
    const raw = await createAudacityWavPackFixture(4800);
    const leading = createApeFileMetadata({ title: 'Before the audio' });
    const backing = new Blob([leading, raw]);
    const readId = 'c'.repeat(64);
    const ranges: number[] = [];
    const file = createDesktopAudioRangeBlob({ id: readId, name: 'Leading.wv', size: backing.size,
        mimeType: 'audio/x-wavpack', readProfile: 'linked-audio-range-v1', lastModified: 0,
        url: `soundscaper-app://bundle/_desktop/read/linked-audio-range-v1/${readId}/Leading.wv`,
    }, { fetch: async (_url, init) => {
            const match = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('Range')!);
            assert.ok(match);
            const start = Number(match[1]), end = Number(match[2]);
            ranges.push(end - start + 1);
            return new Response(await backing.slice(start, end + 1).arrayBuffer(), { status: 206, headers: {
                    'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${backing.size}`,
                    'Content-Length': String(end - start + 1), 'Content-Type': 'audio/x-wavpack',
                } });
        } });
    try {
        const tags = await readImportedMetadataTags(file);
        assert.ok(tags && typeof tags === 'object' && 'title' in tags);
        assert.equal(tags.title, 'Before the audio');
        assert.deepEqual(new Uint8Array(await (await wavPackAudioBlob(file)).arrayBuffer()), raw);
        assert.ok(ranges.every(size => size < backing.size));
    }
    finally {
        retireDesktopAudioRangeBlob(file);
    }
});
test('trailing APE and ID3 retain native precedence over leading APE', async () => {
    const raw = await createAudacityWavPackFixture(4800);
    const leading = createApeFileMetadata({ title: 'Leading' });
    const id3 = new Uint8Array(128);
    id3.set(new TextEncoder().encode('TAGLegacy title'));
    for (const trailing of [new Uint8Array(), createApeFileMetadata({ title: 'Trailing' })]) {
        const file = new Blob([leading, raw, trailing, id3]);
        const tags = await readImportedMetadataTags(file);
        assert.ok(tags && typeof tags === 'object' && 'title' in tags);
        assert.equal(tags.title, trailing.length ? 'Trailing' : 'Legacy title');
        assert.deepEqual(new Uint8Array(await (await wavPackAudioBlob(file)).arrayBuffer()), raw);
    }
});
test('oversized optional leading fields keep PCM available and report the inspection limit', async () => {
    const raw = await createAudacityWavPackFixture(4800);
    const leading = createApeFileMetadata({ title: 'Leading' });
    new DataView(leading.buffer).setUint32(16, 257, true);
    new DataView(leading.buffer).setUint32(leading.length - 16, 257, true);
    const file = new Blob([leading, raw]);
    assert.deepEqual(new Uint8Array(await (await wavPackAudioBlob(file)).arrayBuffer()), raw);
    const inspection = await inspectImportedMediaMetadata(file);
    assert.match(inspection.warnings.join('\n'), /bounded inspection limit/u);
    const invalid = leading.slice();
    new DataView(invalid.buffer).setUint32(invalid.length - 16, 258, true);
    await assert.rejects(wavPackAudioBlob(new Blob([invalid, raw])), /footer is missing or inconsistent/u);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(wavPackAudioBlob(file, abort.signal), { name: 'AbortError' });
});
