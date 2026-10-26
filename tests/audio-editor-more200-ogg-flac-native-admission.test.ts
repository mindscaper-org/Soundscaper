/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, MockAudioBuffer } from './helpers/audio-editor-multitrack-selection-harness.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { ordinaryOggFlacFixture } from './helpers/ogg-multiplexed-tail-fixture.ts';
import { nativeOggFlacAdmission, assertNativeOggFlacGeometry } from '../src/common/editor/controller/import/internal/native-ogg-flac-admission.ts';
import { oggPageCrc } from '../src/common/editor/ogg-page-crc.ts';
import { ordinaryOggOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';

for (const generic of [true, false]) test(`File Import Ogg-FLAC retains native PCM with generic name=${String(generic)}`, async () => {
	const original = await ordinaryOggFlacFixture();
	const file = new File([original], generic ? 'Recorder.bin' : original.name, { type: generic ? '' : original.type });
	const { store } = await createTwoTrackFixture(`ogg-flac-${String(generic)}`, new Map<string, Float32Array>(), 48_000);
	const input = new MockAudioBuffer(1, 1024, 48_000); let decodes = 0;
	for (let frame = 0; frame < input.length; frame++) input.getChannelData(0)[frame] = .3 * Math.sin(2 * Math.PI * 440 * frame / 48_000);
	const engine = Object.assign(createMemoryEngine(), { async decodeAudioData(bytes: ArrayBuffer, options: Readonly<{ sampleRate: number | null }>) {
		assert.equal(options.sampleRate, 48_000); assert.deepEqual(Buffer.from(bytes), Buffer.from(await original.arrayBuffer())); decodes++; return input;
	} });
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: engine as unknown as Options['engine'], ffmpeg: { dispose() {} } as Options['ffmpeg'] });
	try {
		await controller.ready; await controller.actions.project.importFiles([file], { destination: 'timeline' });
		const project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(decodes, 1); assert.equal(project.sources.length, 1);
		const source = project.sources[0]!; assert.equal(source.frameCount, 1024); assert.equal(source.sampleRate, 48_000);
		const actual: number[] = []; for await (const chunk of store.readSourceChunks(source.storageKey)) actual.push(...chunk.channels[0]!);
		assert.deepEqual(actual, [...input.getChannelData(0)]);
	} finally { await controller.dispose(); }
});

test('native Ogg-FLAC admission is bounded and stays in the import execution chunk', async () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/controller/import/internal/native-ogg-flac-admission.ts'), 'editor-import-admission');
	const file = await ordinaryOggFlacFixture(); let reads = 0;
	class BoundedFile extends File { override slice(start = 0, end = this.size, type = ''): Blob {
		assert.ok(end - start <= 79); reads++; return super.slice(start, end, type);
	} }
	const admission = await nativeOggFlacAdmission(new BoundedFile([file], file.name));
	assert.deepEqual(admission, { sampleRate: 48_000, channelCount: 1, frameCount: 1024 }); assert.equal(reads, 1);
	assert.equal(await nativeOggFlacAdmission(await ordinaryOggOpusFixture()), null);
	assert.equal(await nativeOggFlacAdmission(file, { codecRuntime: { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true } }), null);
	assert.equal(await nativeOggFlacAdmission(new Blob([new ArrayBuffer(32 * 1024 ** 2 + 1)])), null);
	assert.doesNotThrow(() => assertNativeOggFlacGeometry({ sampleRate: 48_000, numberOfChannels: 1, length: 1024 }, admission));
	for (const decoded of [{ sampleRate: 44_100, numberOfChannels: 1, length: 1024 }, { sampleRate: 48_000, numberOfChannels: 2, length: 1024 },
		{ sampleRate: 48_000, numberOfChannels: 1, length: 1025 }]) assert.throws(() => assertNativeOggFlacGeometry(decoded, admission), /geometry/u);
});

test('unknown, oversized and unauthenticated Ogg-FLAC extents do not opt into native allocation', async () => {
	const file = await ordinaryOggFlacFixture();
	for (const count of [0n, 128n * 1024n ** 2n]) {
		const bytes = new Uint8Array(await file.arrayBuffer()); const view = new DataView(bytes.buffer);
		view.setBigUint64(55, view.getBigUint64(55) & ~0xf_ffff_ffffn | count); view.setUint32(22, oggPageCrc(bytes.subarray(0, 79)), true);
		assert.equal(await nativeOggFlacAdmission(new Blob([bytes])), null);
	}
	const invalid = new Uint8Array(await file.arrayBuffer()); invalid[22] = invalid[22]! ^ 1;
	assert.equal(await nativeOggFlacAdmission(new Blob([invalid])), null);
	const abort = new AbortController(); abort.abort(new DOMException('Canceled import', 'AbortError'));
	await assert.rejects(nativeOggFlacAdmission(file, { signal: abort.signal }), { name: 'AbortError' });
	const pending = new AbortController();
	class RetiredFile extends File { override slice(start = 0, end = this.size, type = ''): Blob {
		const part = super.slice(start, end, type); const read = part.arrayBuffer.bind(part);
		part.arrayBuffer = async () => { const bytes = await read(); pending.abort(); return bytes; }; return part;
	} }
	await assert.rejects(nativeOggFlacAdmission(new RetiredFile([file], file.name), { signal: pending.signal }), { name: 'AbortError' });
});
