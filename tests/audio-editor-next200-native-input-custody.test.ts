/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { MockAudioBuffer } from './helpers/mock-audio-context.js';
import { nativeMsAdpcmFixture } from './helpers/native-ms-adpcm-fixture.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
test('native import retains source-header authority when the browser transfers its decode input', async context => {
	const { file, channels, decodedFrames } = nativeMsAdpcmFixture();
	let nativeCalls = 0, codecCalls = 0;
	const engine = { ...createMemoryEngine(), async decodeAudioData(encoded: ArrayBuffer) {
		nativeCalls++; structuredClone(encoded, { transfer: [encoded] }); assert.equal(encoded.byteLength, 0);
		const audio = new MockAudioBuffer(2, decodedFrames, 48_000);
		channels.forEach((channel, index) => audio.getChannelData(index).set(channel)); return audio;
	} };
	const ffmpeg = { ...createMemoryFfmpeg(), async decode() { codecCalls++; throw new Error('Native-compatible audio must not require a different decoder.'); } };
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		engine: engine as unknown as Options['engine'], ffmpeg: ffmpeg as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.importFiles([file]);
	assert.equal(nativeCalls, 1); assert.equal(codecCalls, 0);
	assert.equal(controller.project?.clips.length, 1);
	const source = controller.project?.sources[0]; assert.ok(source?.kind === 'audio');
	assert.equal(source.sampleRate, 48_000); assert.equal(source.frameCount, 4800);
	const chunk = await store.readSourceChunk(source.storageKey, 0); assert.ok(chunk);
	assertPcmChannelsEqual(chunk.channels, channels.map(channel => channel.subarray(0, 4800)));
});
