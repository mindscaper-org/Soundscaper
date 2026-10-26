/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportVideoFile, type ImportVideoRuntime } from '../src/common/editor/controller/import/internal/source-import.ts';
import { bufferFromChannels, canonicalizeBuffer } from '../src/common/editor/controller/source/source-audio.ts';
import { createFixture, videoFile } from './helpers/audio-editor-source-import-fixture.ts';

for (const mode of ['native', 'container']) for (const channelCount of [1, 2, 6, 8]) test(`${mode} video extraction retains all ${String(channelCount)} authored channels`, async () => {
	const fixture = createFixture();
	const channels = Array.from({ length: channelCount }, (_, channel) => Float32Array.from({ length: 8 }, (_, frame) => (channel + 1) / 64 + frame / 128));
	const input = { sampleRate: 48_000, length: 8, numberOfChannels: channelCount, getChannelData: (channel: number) => channels[channel]! };
	const persisted: Float32Array[][] = [];
	const runtime: ImportVideoRuntime = { ...fixture.runtime,
		engine: { ...fixture.runtime.engine, decodeAudioData: () => mode === 'native' ? Promise.resolve(input) : Promise.reject(new DOMException('Use container decoder', 'EncodingError')) },
		decodeContainerAudio: () => Promise.resolve({ channels, sampleRate: 48_000 }),
		bufferFromChannels, canonicalizeBuffer, fitAudioBufferToFrames: buffer => buffer,
		async writeBuffer(target, buffer) {
			const actual = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
			persisted.push(actual); await target.write(actual);
		},
	};
	const result = await createImportVideoFile(runtime)(videoFile('Surround camera.webm'));
	assert.ok(result.audioSourceId);
	assert.equal(fixture.addedSources.find(source => source.kind === 'audio')?.channelCount, channelCount);
	assert.deepEqual(persisted, [channels]);
});
