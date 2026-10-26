/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { aacLcAdtsPceFixture } from './helpers/os-audio-codec-fixtures.ts';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, MockAudioBuffer } from './helpers/audio-editor-multitrack-selection-harness.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { nativeContainerAudioAdmission, assertNativeContainerAudioGeometry } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

for (const generic of [true, false]) test(`File Import preserves native AAC programme-configuration PCM with generic name=${String(generic)}`, async () => {
	const original = aacLcAdtsPceFixture();
	const file = new File([original], generic ? 'Recording.bin' : 'Recording.aac', { type: generic ? 'application/octet-stream' : 'audio/aac' });
	const { store } = await createTwoTrackFixture(`adts-pce-${String(generic)}`, new Map<string, Float32Array>(), 48_000);
	const input = new MockAudioBuffer(2, 6144, 48_000); let decodes = 0;
	for (let channel = 0; channel < 2; channel++) input.getChannelData(channel).fill(channel ? -.125 : .25);
	const engine = Object.assign(createMemoryEngine(), { async getAudioContext() { return { sampleRate: 48_000,
		createBuffer: (channels: number, frames: number, rate: number) => new MockAudioBuffer(channels, frames, rate) }; },
	async decodeAudioData(bytes: ArrayBuffer, options: Readonly<{ sampleRate: number | null }>) {
		assert.equal(options.sampleRate, null); assert.deepEqual(Buffer.from(bytes), Buffer.from(original)); decodes++; return input;
	} });
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: engine as unknown as Options['engine'], ffmpeg: { dispose() {} } as Options['ffmpeg'] });
	try {
		await controller.ready; await controller.actions.project.importFiles([file], { destination: 'timeline' });
		assert.equal(decodes, 1);
		const project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project)); assert.equal(project.sources.length, 1);
		const source = project.sources[0]!; assert.equal(source.frameCount, 6144); assert.equal(source.sampleRate, 48_000); assert.equal(source.channelCount, 2);
		const actual: number[][] = [[], []];
		for await (const chunk of store.readSourceChunks(source.storageKey)) for (let channel = 0; channel < 2; channel++) actual[channel]!.push(...chunk.channels[channel]!);
		assert.deepEqual(actual, [Array.from(input.getChannelData(0)), Array.from(input.getChannelData(1))]);
	} finally { await controller.dispose(); }
});

test('PCE admission keeps the native clock and bounds all possible channel allocations before decoding', async () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/controller/import/internal/native-container-audio-admission.ts'), 'editor-import-admission');
	const source = aacLcAdtsPceFixture(); let nativeCalls = 0; let reads = 0;
	class BoundedFile extends Blob { override slice(start = 0, end = this.size, type = ''): Blob {
		assert.ok(end - start <= 79); reads++; return super.slice(start, end, type);
	} }
	const options = { nativeSampleRate: () => { nativeCalls++; return 44_100; } };
	const admission = await nativeContainerAudioAdmission(new BoundedFile([source]), options);
	assert.deepEqual(admission, { sampleRate: 44_100, frameCount: 5645, channelCount: null }); assert.equal(nativeCalls, 1); assert.ok(reads > 6);
	for (const frameCount of [5644, 5645, 5646]) assert.doesNotThrow(() => assertNativeContainerAudioGeometry({ sampleRate: 44_100, numberOfChannels: 2, length: frameCount }, admission));
	for (const decoded of [{ sampleRate: 48_000, numberOfChannels: 2, length: 6144 }, { sampleRate: 44_100, numberOfChannels: 33, length: 5645 },
		{ sampleRate: 44_100, numberOfChannels: 2, length: 5647 }, { sampleRate: 44_100, numberOfChannels: 2, length: NaN }]) {
		assert.throws(() => assertNativeContainerAudioGeometry(decoded, admission), /geometry/u);
	}
	const tagged = new Blob([Uint8Array.of(73, 68, 51, 3, 0, 0, 0, 0, 0, 0), source]);
	assert.deepEqual(await nativeContainerAudioAdmission(tagged, options), admission);
	const footerHeader = Uint8Array.of(73, 68, 51, 4, 0, 16, 0, 0, 0, 0);
	const footer = Uint8Array.of(51, 68, 73, ...footerHeader.subarray(3));
	assert.deepEqual(await nativeContainerAudioAdmission(new Blob([footerHeader, footer, source]), options), admission);
	const large = new Blob(Array.from({ length: 200 }, () => source));
	assert.equal(await nativeContainerAudioAdmission(large, options), null);
});

test('healthy incremental profiles, desktop codecs, invalid ADTS and unsupported extents retain their existing routes', async () => {
	const source = aacLcAdtsPceFixture(); let calls = 0;
	const options = { nativeSampleRate: () => { calls++; return 48_000; } };
	assert.equal(await nativeContainerAudioAdmission(new Blob([aacLcAdtsPceFixture(false)]), options), null);
	assert.equal(await nativeContainerAudioAdmission(new Blob([source]), { ...options, codecRuntime: { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true } }), null);
	assert.equal(await nativeContainerAudioAdmission(new Blob([new ArrayBuffer(32 * 1024 ** 2 + 1)]), options), null);
	for (const [at, mask] of [[0, 1], [2, 0x80], [6, 1]] as const) {
		const bytes = source.slice(); bytes[at] = bytes[at]! ^ mask;
		assert.equal(await nativeContainerAudioAdmission(new Blob([bytes]), options), null);
	}
	assert.equal(calls, 0);
	assert.equal(await nativeContainerAudioAdmission(new Blob([source.subarray(0, -1)]), options), null);
	assert.equal(await nativeContainerAudioAdmission(new Blob([source, Uint8Array.of(0)]), options), null);
	for (const nativeRate of [NaN, 2999, 768_001]) assert.equal(await nativeContainerAudioAdmission(new Blob([source]), { nativeSampleRate: () => nativeRate }), null);
});

test('abort during header or native-context admission retires the native route before publication', async () => {
	const source = aacLcAdtsPceFixture(); const abort = new AbortController();
	class RetiredFile extends Blob { override slice(start = 0, end = this.size, type = ''): Blob {
		const part = super.slice(start, end, type); const read = part.arrayBuffer.bind(part);
		part.arrayBuffer = async () => { const bytes = await read(); abort.abort(); return bytes; }; return part;
	} }
	await assert.rejects(nativeContainerAudioAdmission(new RetiredFile([source]), { signal: abort.signal, nativeSampleRate: () => { assert.fail('native context must remain untouched'); } }), { name: 'AbortError' });
	const pending = new AbortController();
	await assert.rejects(nativeContainerAudioAdmission(new Blob([source]), { signal: pending.signal, nativeSampleRate: () => { pending.abort(); return 48_000; } }), { name: 'AbortError' });
});
