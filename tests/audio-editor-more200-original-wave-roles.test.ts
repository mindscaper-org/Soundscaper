/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { nativeOriginalImportFixture } from './helpers/native-original-import-fixture.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { audioBuffer, createMemoryRenderEngine } from './helpers/audio-editor-controller-harness.js';
import { createWavBlobPcmChunkReader } from '../src/common/editor/wav-pcm-chunk-reader.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';

for (const [channelCount, channelMask] of [[2, 5], [2, 9], [2, 0x30], [1, 1]] as const) {
	test(`Original refuses an unrepresentable ${String(channelCount)}-channel WAVE mask ${String(channelMask)}`, async () => {
		const channels = Array.from({ length: channelCount }, () => Float32Array.of(.125, -.0625));
		const file = new File([new Uint8Array(encodeWav(channels, { sampleRate: 48_000, bitDepth: 20, channelMask, dither: false })).buffer], 'Roles.wav');
		const descriptor = await inspectWavBlobPcm(file);
		assert.equal(descriptor.channelMask, channelMask);
		const original = channels.map(channel => channel.slice());
		assert.equal(await resolveDesktopOriginalExportSettings(file, [{ kind: 'audio', ...descriptor }]), null);
		assert.deepEqual(channels, original);
	});
}
for (const [channelCount, channelMask] of [[2, 3], [2, 0], [1, 4], [1, 0]] as const) {
	test(`Original keeps its admitted ${String(channelCount)}-channel WAVE mask ${String(channelMask)} profile`, async () => {
		const channels = Array.from({ length: channelCount }, () => Float32Array.of(.125, -.0625));
		const file = new File([new Uint8Array(encodeWav(channels, { sampleRate: 48_000, bitDepth: 20, channelMask, dither: false })).buffer], 'Roles.wav');
		const descriptor = await inspectWavBlobPcm(file);
		const settings = await resolveDesktopOriginalExportSettings(file, [{ kind: 'audio', ...descriptor }]);
		assert.ok(settings); assert.equal(settings.sampleFormat, 'int20');
		assert.equal(settings.channelMapping, channelCount === 1 ? 'mono' : 'stereo');
	});
}

for (const [channelCount, channelMask] of [[2, 5], [2, 9], [2, 0x30], [1, 1], [2, 3], [2, 0], [1, 4], [1, 0]] as const) {
	test(`native controller preserves ${channelCount}-channel mask ${channelMask} when offering or refusing Original`, async context => {
		const channels = Array.from({ length: channelCount }, (_, channel) => new Float32Array(2400).fill(channel ? -.0625 : .125));
		const file = new File([Uint8Array.from(encodeWav(channels, { sampleRate: 48_000, bitDepth: 20, channelMask, dither: false }))], 'Roles.wav');
		const native = await nativeOriginalImportFixture(file); context.after(native.close);
		const required = new Set(['chooseFiles', 'releaseRead', 'releaseOriginalFile', 'prepareOriginalOverwrite', 'releaseSaveTarget', 'beginWrite', 'writeChunk', 'patchFinalPrefix', 'finishWrite', 'abortWrite']);
		const service = createAudioEditorFileService({ bridge: Object.fromEntries(Object.entries(native.bridge).filter(([key]) => required.has(key))), fetch: native.fetch });
		type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
		const { controller } = await controllerSession(context, { fileService: service, engineFactory: (() => ({ ...createMemoryRenderEngine(),
			renderMix: async () => audioBuffer(channelCount === 1 ? [channels[0]!, new Float32Array(2400)] : channels, 48_000),
		})) as unknown as Options['engineFactory'] });
		const descriptors = await service.chooseFiles({ purpose: 'audio', multiple: false });
		await service.withReadDescriptors(descriptors, {}, async (files: readonly File[]) => { await controller.actions.project.importFiles(files); });
		const admitted = channelMask === 0 || channelMask === (channelCount === 1 ? 4 : 3);
		assert.equal(controller.actions.export.overwriteOriginalAvailable(), admitted);
		if (admitted) { await controller.actions.export.overwriteOriginal(); assert.equal(native.completed.length, 1); }
		else {
			assert.equal(controller.actions.export.originalFile(), null);
			assert.equal(native.prepared.length, 0); assert.equal(native.completed.length, 0);
			assert.deepEqual(new Uint8Array(await native.savedBytes()), new Uint8Array(await file.arrayBuffer()));
		}
		const output = new Blob([Uint8Array.from(await native.savedBytes())]), descriptor = await inspectWavBlobPcm(output);
		assert.equal(descriptor.channelMask, admitted && channelMask === 0 ? (channelCount === 1 ? 4 : 3) : channelMask); assert.equal(descriptor.frameCount, 2400); assert.equal(descriptor.channelCount, channelCount);
		const chunk = await createWavBlobPcmChunkReader(output, { descriptor }).readChunk(0);
		for (let channel = 0; channel < channelCount; channel++) {
			const expected = (channel ? -.0625 : .125) * (admitted && channelCount === 1 ? .5 : 1);
			assert.ok(chunk.channels[channel]?.every(sample => Math.abs(sample - expected) < .00001), JSON.stringify({ sample: chunk.channels[channel]?.[1200], first: chunk.channels[channel]?.[0], last: chunk.channels[channel]?.[2399], expected }));
		}
	});
}
