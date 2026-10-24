/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeContainerAudioAdmission, assertNativeContainerAudioGeometry } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { nativeMpegLayerOneFixture } from './helpers/native-mpeg-layer-one-fixture.ts';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, MockAudioBuffer } from './helpers/audio-editor-multitrack-selection-harness.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

for (const generic of [false, true]) test(`File Import retains native LayerI PCM with opaque identity=${String(generic)}`, async () => {
	const { file: original, channels } = nativeMpegLayerOneFixture();
	const file = generic ? new File([original], 'Reference.bin', { type: 'application/octet-stream' }) : original;
	const { store } = await createTwoTrackFixture(`native-layer-one-${String(generic)}`, new Map<string, Float32Array>(), 48_000);
	const input = new MockAudioBuffer(2, 18_816, 32_000); let decodes = 0;
	for (let channel = 0; channel < 2; channel++) input.getChannelData(channel).set(channels[channel]!);
	const engine = Object.assign(createMemoryEngine(), { async getAudioContext() { return { sampleRate: 44_100,
		createBuffer: (count: number, frames: number, rate: number) => new MockAudioBuffer(count, frames, rate) }; },
	async decodeAudioData(bytes: ArrayBuffer, options: Readonly<{ sampleRate: number | null }>) {
		assert.equal(options.sampleRate, 32_000); assert.deepEqual(Buffer.from(bytes), Buffer.from(await original.arrayBuffer())); decodes++; return input;
	} });
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: engine as unknown as Options['engine'], ffmpeg: { dispose() {} } as Options['ffmpeg'] });
	try {
		await controller.ready; await controller.actions.project.importFiles([file]); assert.equal(decodes, 1);
		const project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project)); assert.equal(project.sources.length, 1);
		const source = project.sources[0]!; assert.equal(source.sampleRate, 32_000); assert.equal(source.frameCount, 18_816); assert.equal(source.channelCount, 2);
		const actual: number[][] = [[], []];
		for await (const chunk of store.readSourceChunks(source.storageKey)) for (let channel = 0; channel < 2; channel++) actual[channel]!.push(...chunk.channels[channel]!);
		assert.deepEqual(actual, channels.map(channel => [...channel]));
	} finally { await controller.dispose(); }
});

test('complete LayerI inventory selects the authored native clock and exact geometry', async () => {
	const { file } = nativeMpegLayerOneFixture();
	const admission = await nativeContainerAudioAdmission(file, { nativeSampleRate: () => assert.fail('LayerI must not inherit the device clock') });
	assert.deepEqual(admission, { sampleRate: 32_000, decodeSampleRate: 32_000, channelCount: 2, frameCount: 18_816 });
	assert.doesNotThrow(() => assertNativeContainerAudioGeometry({ sampleRate: 32_000, numberOfChannels: 2, length: 18_816 }, admission));
	for (const geometry of [{ sampleRate: 44_100, numberOfChannels: 2, length: 25_931 }, { sampleRate: 32_000, numberOfChannels: 1, length: 18_816 },
		{ sampleRate: 32_000, numberOfChannels: 2, length: 18_817 }]) assert.throws(() => assertNativeContainerAudioGeometry(geometry, admission), /geometry/u);
	assert.equal(chunkGroupForModulePath('src/common/editor/controller/import/internal/native-mpeg-layer-one-admission.ts'), 'editor-import-admission');
});

test('ordinary leading ID3 remains outside the LayerI audio inventory', async () => {
	const { file } = nativeMpegLayerOneFixture();
	const tagged = new Blob([Uint8Array.from(createAudioMetadataId3Tag({ title: 'Layer one recording' })), file]);
	assert.deepEqual(await nativeContainerAudioAdmission(tagged, { nativeSampleRate: () => 44_100 }),
		{ sampleRate: 32_000, decodeSampleRate: 32_000, channelCount: 2, frameCount: 18_816 });
});

for (const kind of ['sync', 'version', 'layer', 'rate', 'bitrate', 'emphasis', 'channels', 'truncated', 'trailing', 'single'] as const) {
	test(`unqualified ${kind} MPEG input retains its existing decoder decision`, async () => {
		let bytes = new Uint8Array(await nativeMpegLayerOneFixture().file.arrayBuffer());
		if (kind === 'sync') bytes[576] = 0;
		if (kind === 'version') bytes[577] = bytes[577]! ^ 8;
		if (kind === 'layer') bytes[577] = bytes[577]! ^ 2;
		if (kind === 'rate') bytes[578] = bytes[578]! ^ 4;
		if (kind === 'bitrate') bytes[578] = bytes[578]! | 0xf0;
		if (kind === 'emphasis') bytes[579] = bytes[579]! & 0xfc | 2;
		if (kind === 'channels') bytes[579] = bytes[579]! | 0xc0;
		if (kind === 'truncated') bytes = bytes.subarray(0, bytes.length - 1);
		if (kind === 'single') bytes = bytes.subarray(0, 576);
		const file = new Blob([bytes, ...(kind === 'trailing' ? [Uint8Array.of(0)] : [])]);
		assert.equal(await nativeContainerAudioAdmission(file, { nativeSampleRate: () => assert.fail('Unqualified MPEG must not allocate a context') }), null);
	});
}

test('native LayerI admission preserves desktop ownership and encoded/decoded admission budgets', async () => {
	const options = { nativeSampleRate: () => assert.fail('Refused admission must not allocate a context') };
	assert.equal(await nativeContainerAudioAdmission(nativeMpegLayerOneFixture().file, { ...options,
		codecRuntime: { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true } }), null);
	class Oversized extends Blob { override get size(): number { return 32 * 1024 ** 2 + 1; }
		override slice(): Blob { throw new Error('Oversized input must not be read'); } }
	assert.equal(await nativeContainerAudioAdmission(new Oversized(), options), null);
	// Legal minimum-size32k stereo headers exceed128MiB PCM before encoded32MiB.
	const packets = Math.floor(128 * 1024 ** 2 / (384 * 2 * 4)) + 1;
	const bytes = new Uint8Array(packets * 48);
	for (let frame = 0; frame < packets; frame++) bytes.set([255, 254, 24, 4], frame * 48);
	assert.equal(await nativeContainerAudioAdmission(new Blob([bytes]), options), null);
});

test('Cancel retires a pending LayerI header without traversing or replacing the original reason', { timeout: 2000 }, async () => {
	const original = nativeMpegLayerOneFixture().file, abort = new AbortController(); let reads = 0;
	let enter = (): void => {}; const entered = new Promise<void>(resolve => { enter = resolve; });
	let complete = (_bytes: ArrayBuffer): void => {};
	class Held extends File { override slice(start = 0, end = this.size): Blob {
		const part = super.slice(start, end); const read = part.arrayBuffer.bind(part);
		part.arrayBuffer = () => {
			reads++;
			return start === 576 && end - start === 4 ? new Promise(resolve => { complete = resolve; enter(); }) : read();
		}; return part;
	} }
	const pending = nativeContainerAudioAdmission(new Held([original], original.name), { signal: abort.signal, nativeSampleRate: () => 44_100 });
	await entered; const reason = new DOMException('Retired LayerI import', 'AbortError'); abort.abort(reason);
	await assert.rejects(pending, (error: unknown) => error === reason); const retiredReads = reads;
	complete(new ArrayBuffer(4)); await new Promise<void>(resolve => setTimeout(resolve, 0)); assert.equal(reads, retiredReads);
	assert.ok(await nativeContainerAudioAdmission(original, { nativeSampleRate: () => 44_100 }));
});
