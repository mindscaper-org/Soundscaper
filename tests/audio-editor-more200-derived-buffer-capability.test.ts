/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDerivedSourceService, type DerivedSourceServiceDependencies } from '../src/common/editor/controller/track-audio/internal/derived-audio/derived-source-service.ts';
import { SOURCE_CHUNK_FRAMES, writeBuffer, type AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import type { ControllerProject, ControllerSource } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

const pcm = Float32Array.from({ length: SOURCE_CHUNK_FRAMES + 5 }, (_, index) => (index % 13) / 13);
const unsupported = new DOMException('Sample rate is not in the supported range.', 'NotSupportedError');

for (const failure of [null, unsupported]) test(`derived PCM is durable independently of its optional native cache: ${failure?.name ?? 'supported'}`, async () => {
	const fixture = createFixture(failure);
	const result = await fixture.service.persistDerivedSource(template, [pcm], 'Derived');
	assert.equal(result.buffer === null, failure !== null);
	assert.equal(fixture.buffers.size, failure ? 0 : 1);
	assert.deepEqual(fixture.writes.map(chunk => chunk[0]?.length), [SOURCE_CHUNK_FRAMES, 5]);
	assert.deepEqual(Float32Array.from(fixture.writes.flatMap(chunk => [...chunk[0]!])), pcm);
	assert.equal(fixture.commits(), 1);
	assert.equal(fixture.peaks.size, 1);
	assert.equal(result.source.sampleRate, 768_000);
	assert.equal(result.source.frameCount, pcm.length);
});

for (const failure of [new RangeError('Allocation failed'), new DOMException('Cache quota exceeded', 'QuotaExceededError')]) {
	test(`derived audio does not suppress ${failure.name}`, async () => {
		const fixture = createFixture(failure);
		await assert.rejects(fixture.service.persistDerivedSource(template, [pcm], 'Derived'), error => error === failure);
		assert.equal(fixture.writes.length, 0);
		assert.equal(fixture.commits(), 0);
	});
}

test('a retired source edit cannot publish after native cache refusal', async () => {
	const fixture = createFixture(unsupported, true);
	await assert.rejects(fixture.service.persistDerivedSource(template, [pcm], 'Derived'), { code: 'PROJECT_CHANGED' });
	assert.equal(fixture.writes.length, 0);
	assert.equal(fixture.buffers.size, 0);
});

const template: ControllerSource = { id: 'source', storageKey: 'source', name: 'Source', mimeType: 'audio/wav',
	frameCount: pcm.length, channelCount: 1, sampleRate: 768_000, originalSampleRate: 768_000, sampleFormat: 'float32' };

function createFixture(failure: Error | null, retireOnAllocation = false) {
	const buffers = new Map<string, AudioBufferLike>(), peaks = new Map<string, unknown>();
	const writes: Float32Array[][] = [];
	let committed = 0, current = true;
	const project: ControllerProject = { schemaVersion: 17, id: 'project', title: 'Project', sampleRate: 48_000,
		tracks: [], clips: [], sources: [template], selection: null, mixer: { groups: [], sends: [], routes: {} }, trackFolders: [] };
	const dependencies: DerivedSourceServiceDependencies = {
		lifetime: { assertActive() {} }, copy: { effectInvalidAudio: 'Invalid audio' }, sourceBuffers: buffers, sourcePeaks: peaks,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES, getProject: () => project, captureProject: () => ({ generation: 1, projectId: project.id }),
		assertProject() { if (!current) throw Object.assign(new Error('Project changed'), { code: 'PROJECT_CHANGED' }); },
		createId: () => 'derived', projectSampleRate: () => 48_000, getAudioContext: async () => ({}),
		createBufferFromChannels: async (channels, sampleRate) => {
			if (retireOnAllocation) current = false;
			if (failure) throw failure;
			return { length: channels[0]!.length, numberOfChannels: channels.length, sampleRate,
				getChannelData: channel => channels[channel]! };
		},
		loadSourceChannels: async () => [pcm], writeBuffer,
		generateWaveformPeaks: async () => ({ levels: [] }), peakCacheKey: id => `peaks:${id}`,
		cacheSourceBuffer: (id, buffer) => buffers.set(id, buffer), retireSourceChunkProvider() {},
		store: {
			beginSourceWrite: async () => ({ write(channels) { writes.push(channels); }, commit() { committed++; }, abort() {} }),
			saveAnalysis: async () => undefined, deleteAnalysis: async () => undefined, deleteSource: async () => undefined,
		},
	};
	return { service: createDerivedSourceService(dependencies), buffers, peaks, writes, commits: () => committed };
}
