/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { alacM4a48_000Fixture, aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, MockAudioBuffer } from './helpers/audio-editor-multitrack-selection-harness.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { nativeContainerAudioAdmission, assertNativeContainerAudioGeometry } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

for (const generic of [false, true]) test(`File Import preserves native ALAC with generic name=${String(generic)}`, async () => {
	const original = alacM4a48_000Fixture(); const file = new File([original], generic ? 'Lossless.bin' : 'Lossless.m4a');
	const { store } = await createTwoTrackFixture(`alac-${String(generic)}`, new Map<string, Float32Array>(), 48_000);
	const input = new MockAudioBuffer(2, 4800, 48_000); let decodes = 0;
	for (let channel = 0; channel < 2; channel++) input.getChannelData(channel).fill(channel ? -.125 : .25);
	const engine = Object.assign(createMemoryEngine(), { async getAudioContext() { return { sampleRate: 44_100,
		createBuffer: (channels: number, frames: number, rate: number) => new MockAudioBuffer(channels, frames, rate) }; },
	async decodeAudioData(bytes: ArrayBuffer, options: Readonly<{ sampleRate: number | null }>) {
		assert.equal(options.sampleRate, generic ? null : 48_000); assert.deepEqual(Buffer.from(bytes), Buffer.from(original)); decodes++; return input;
	} });
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: engine as unknown as Options['engine'], ffmpeg: { dispose() {} } as Options['ffmpeg'] });
	try {
		await controller.ready; await controller.actions.project.importFiles([file], { destination: 'timeline' });
		assert.equal(decodes, 1);
		const project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project)); assert.equal(project.sources.length, 1);
		const source = project.sources[0]!; assert.equal(source.frameCount, 4800); assert.equal(source.sampleRate, 48_000); assert.equal(source.channelCount, 2);
		const actual: number[][] = [[], []];
		for await (const chunk of store.readSourceChunks(source.storageKey)) for (let channel = 0; channel < 2; channel++) actual[channel]!.push(...chunk.channels[channel]!);
		assert.deepEqual(actual, [Array.from(input.getChannelData(0)), Array.from(input.getChannelData(1))]);
	} finally { await controller.dispose(); }
});

test('ALAC admission pins its lossless source clock and verifies exact geometry before publication', async () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/controller/import/internal/native-alac-import-admission.ts'), 'editor-import-admission');
	const admission = await nativeContainerAudioAdmission(new Blob([alacM4a48_000Fixture()]), { nativeSampleRate: () => assert.fail('ALAC does not inherit the device clock') });
	assert.deepEqual(admission, { sampleRate: 48_000, frameCount: 4800, channelCount: 2, decodeSampleRate: 48_000 });
	for (const decoded of [{ sampleRate: 44_100, numberOfChannels: 2, length: 4410 }, { sampleRate: 48_000, numberOfChannels: 1, length: 4800 },
		{ sampleRate: 48_000, numberOfChannels: 2, length: 4801 }]) assert.throws(() => assertNativeContainerAudioGeometry(decoded, admission), /geometry/u);
	assert.doesNotThrow(() => assertNativeContainerAudioGeometry({ sampleRate: 48_000, numberOfChannels: 2, length: 4800 }, admission));
});

test('ALAC preflight rejects oversized native frames and presentation edits before decoding', async () => {
	const options = { nativeSampleRate: () => assert.fail('unsupported geometry must not allocate a native context') };
	for (const kind of ['frames', 'rate', 'trim', 'duration'] as const) {
		const bytes = Buffer.from(alacM4a48_000Fixture()); const cookie = bytes.indexOf('alac', bytes.indexOf('alac') + 1);
		if (kind === 'frames') bytes.writeUInt32BE(0xffff_ffff, cookie + 8);
		if (kind === 'rate') bytes.writeUInt32BE(44_100, cookie + 28);
		if (kind === 'trim') bytes.writeUInt32BE(50, bytes.indexOf('elst') + 12);
		if (kind === 'duration') {
			bytes.writeUInt32BE(48_000 * 1000, bytes.indexOf('mdhd') + 20);
			bytes.writeUInt32BE(48_000 * 1000 - 4096, bytes.indexOf('stts') + 24);
			bytes.writeUInt32BE(1_000_000, bytes.indexOf('elst') + 12);
		}
		assert.equal(await nativeContainerAudioAdmission(new Blob([new Uint8Array(bytes)]), options), null, kind);
	}
});

test('a later abort during the ALAC sample-description walk is observed before Input or native decode', async () => {
	const abort = new AbortController(); let reads = 0;
	class RetiredFile extends Blob { override slice(start = 0, end = this.size, type = ''): Blob {
		assert.ok(end - start <= 1024 ** 2);
		const part = super.slice(start, end, type); const read = part.arrayBuffer.bind(part);
		part.arrayBuffer = async () => { const bytes = await read(); if (++reads === 8) abort.abort(); return bytes; }; return part;
	} }
	await assert.rejects(nativeContainerAudioAdmission(new RetiredFile([alacM4a48_000Fixture()]), { signal: abort.signal,
		nativeSampleRate: () => assert.fail('retired admission must not allocate a context') }), { name: 'AbortError' });
	assert.equal(reads, 8);
});

test('ordinary AAC, desktop codecs and oversized encoded ALAC keep their existing routes', async () => {
	const options = { nativeSampleRate: () => assert.fail('unqualified profiles must not allocate a native context') };
	assert.equal(await nativeContainerAudioAdmission(new Blob([new Uint8Array(aacLcM4a48_000Fixture())]), options), null);
	assert.equal(await nativeContainerAudioAdmission(new Blob([alacM4a48_000Fixture()]), { ...options, codecRuntime: { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true } }), null);
	assert.equal(await nativeContainerAudioAdmission(new Blob([alacM4a48_000Fixture(), new ArrayBuffer(32 * 1024 ** 2)]), options), null);
});

test('abort during bounded ALAC inspection retires the route before native decode', async () => {
	const abort = new AbortController();
	class RetiredFile extends Blob { override slice(start = 0, end = this.size, type = ''): Blob {
		const part = super.slice(start, end, type); const read = part.arrayBuffer.bind(part);
		part.arrayBuffer = async () => { const bytes = await read(); abort.abort(); return bytes; }; return part;
	} }
	await assert.rejects(nativeContainerAudioAdmission(new RetiredFile([alacM4a48_000Fixture()]), { signal: abort.signal,
		nativeSampleRate: () => assert.fail('retired admission must not allocate a context') }), { name: 'AbortError' });
});
