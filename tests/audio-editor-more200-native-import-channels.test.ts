/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, MockAudioBuffer } from './helpers/audio-editor-multitrack-selection-harness.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { ordinaryWebmOpusFixture, surroundWebmOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

for (const channelCount of [1, 6]) test(`standalone native File Import retains ${channelCount} authored PCM channels`, async () => {
	const { store } = await createTwoTrackFixture(`native-import-${channelCount}`, new Map<string, Float32Array>(), 48_000);
	const input = new MockAudioBuffer(channelCount, 3840, 48_000);
	for (let channel = 0; channel < channelCount; channel++) {
		for (let frame = 0; frame < input.length; frame++) input.getChannelData(channel)[frame] = (channel + 1) / 64 + frame / 100_000;
	}
	const engine = Object.assign(createMemoryEngine(), {
		async decodeAudioData(_bytes: ArrayBuffer, options: Readonly<{ sampleRate: number | null }>) {
			assert.equal(options.sampleRate, 48_000);
			return input;
		},
	});
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: engine as unknown as Options['engine'], ffmpeg: { dispose() {} } as Options['ffmpeg'] });
	try {
		await controller.ready;
		await controller.actions.project.importFiles([channelCount === 6 ? surroundWebmOpusFixture() : await ordinaryWebmOpusFixture()], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 1);
		const source = project.sources[0]!;
		assert.equal(source.channelCount, channelCount);
		assert.equal(source.sampleRate, 48_000);
		assert.equal(source.frameCount, input.length);
		const chunks: (readonly Float32Array[])[] = [];
		for await (const chunk of store.readSourceChunks(source.storageKey)) chunks.push(chunk.channels);
		assert.equal(chunks.length, 1);
		for (let channel = 0; channel < channelCount; channel++) assert.deepEqual(chunks[0]![channel], input.getChannelData(channel));
	} finally { await controller.dispose(); }
});
