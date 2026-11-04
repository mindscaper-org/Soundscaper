/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectImportService } from './helpers/project-import-runtime-fixture.ts';
import { createFixture, deferred, file } from './audio-editor-project-import-service-fixture.ts';
import { createAudioImportDerivativeScheduler, type AudioImportDerivativeRequest } from '../src/common/editor/controller/import/internal/audio-import-derivatives.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';

test('decoded audio is committed and returned before waveform analysis starts', { timeout: 2_000 }, async () => {
	const fixture = createFixture();
	const gate = deferred<void>();
	fixture.options.peakGate = gate.promise;
	const requests: AudioImportDerivativeRequest[] = [];
	try {
		const result = await createProjectImportService({ ...fixture.runtime,
			scheduleAudioDerivatives: (request: AudioImportDerivativeRequest) => { requests.push(request); },
		}).importFile(file('voice.mp3', 'audio/mpeg'));
		assert.ok(result.clipId);
		assert.equal(fixture.commands.length, 1);
		assert.equal(fixture.sourceBuffers.size, 1);
		assert.equal(fixture.calls.includes('peaks-started'), false);
		assert.equal(requests.length, 1);
		assert.equal(requests[0]?.source.id, result.sourceId);
		assert.equal(requests[0]?.channels, undefined, 'Queued analysis must not retain decoded PCM.');
		assert.equal(requests[0]?.storedSource?.frameCount, 4);
	} finally { gate.resolve(); }
});

test('batch imports run one background audio analysis at a time', async () => {
	const fixture = derivativeFixture();
	const started = deferred<void>(), held = deferred<void>();
	fixture.options.generate = async () => { started.resolve(); await held.promise; };
	const second = { ...fixture.source, id: 'second' };
	fixture.project.sources.push(second);
	fixture.scheduler.schedule(fixture.request);
	fixture.scheduler.schedule({ ...fixture.request, source: second });
	await started.promise;
	await new Promise<void>(resolve => { setTimeout(resolve, 0); });
	try { assert.equal(fixture.generated(), 1); }
	finally { held.resolve(); }
	await fixture.scheduler.whenIdle();
	assert.equal(fixture.generated(), 2);
	assert.equal(fixture.peaks.size, 2);
	assert.equal(fixture.protectedIds.size, 0);
});

test('audio derivatives yield to editing and publish before slow cache storage', async () => {
	const fixture = derivativeFixture();
	const held = deferred<void>();
	const storing = deferred<void>();
	fixture.options.save = async () => { storing.resolve(); await held.promise; };
	fixture.scheduler.schedule(fixture.request);
	assert.equal(fixture.generated(), 0);
	assert.equal(fixture.protectedIds.size, 1);
	await storing.promise;
	assert.equal(fixture.peaks.size, 1);
	assert.equal(fixture.published(), 1);
	held.resolve();
	await fixture.scheduler.whenIdle();
	assert.equal(fixture.protectedIds.size, 0);
});

test('incremental PCM imports defer waveform storage until their clip is committed', async () => {
	const fixture = createFixture();
	fixture.options.incrementalDescriptor = { frameCount: 8, channelCount: 1, sampleRate: 48_000, pcmBytes: 32 };
	const requests: AudioImportDerivativeRequest[] = [];
	let activationOptions: Record<string, unknown> | null = null;
	const result = await createProjectImportService({ ...fixture.runtime,
		activateStoredSource: async (source: { id: string }, _metadata: unknown, options: Record<string, unknown>) => {
			activationOptions = options;
			await fixture.runtime.activateStoredSource(source);
		},
		scheduleAudioDerivatives: (request: AudioImportDerivativeRequest) => {
			assert.equal(fixture.commands.length, 1);
			requests.push(request);
		},
	}).importFile(file('voice.wav'));
	assert.ok(result.clipId);
	assert.equal((activationOptions as Record<string, unknown> | null)?.persistPeaks, false);
	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.peaks?.channelCount, 1);
	assert.equal(requests[0]?.channels, undefined);
});

for (const change of ['project', 'delete', 'replace', 'dispose'] as const) {
	test(`audio derivatives discard late results after ${change}`, async () => {
		const fixture = derivativeFixture();
		const held = deferred<void>(), started = deferred<void>();
		fixture.options.generate = async () => { started.resolve(); await held.promise; };
		fixture.scheduler.schedule(fixture.request);
		await started.promise;
		if (change === 'project') fixture.generation.activate('another-project');
		else if (change === 'delete') fixture.project.sources = [];
		else if (change === 'replace') fixture.project.sources = [{ ...fixture.source, contentSha256: 'b'.repeat(64) }];
		else fixture.lifetime.beginDisposal();
		held.resolve();
		await fixture.scheduler.whenIdle();
		assert.equal(fixture.peaks.size, 0);
		assert.equal(fixture.published(), 0);
		assert.equal(fixture.protectedIds.size, 0);
	});
}

test('streamed audio reuses its peaks and optional cache failures preserve them', async () => {
	const fixture = derivativeFixture();
	const peaks = { version: 1, channelCount: 1, levels: [] };
	fixture.options.save = async () => { throw new Error('Optional cache full'); };
	fixture.scheduler.schedule({ ...fixture.request, channels: undefined, peaks });
	await fixture.scheduler.whenIdle();
	assert.equal(fixture.generated(), 0);
	assert.equal(fixture.peaks.get('source'), peaks);
	assert.equal(fixture.published(), 1);
});

test('waveform publication cannot cross projects after audio import commits', async () => {
	const persisted = createFixture();
	const peakGate = deferred<void>();
	persisted.options.peakGate = peakGate.promise;
	const persistedOperation = createProjectImportService(persisted.runtime).importFile(
		file('persisted.mp3', 'audio/mpeg'),
	);
	await persistedOperation;
	while (!persisted.calls.includes('peaks-started')) await new Promise<void>(resolve => { setImmediate(resolve); });
	persisted.setProject({ id: 'replacement', tracks: [], sources: [] });
	peakGate.resolve();
	await persisted.finishDerivatives();
	assert.equal(persisted.commands.length, 1);
	assert.deepEqual(persisted.deletedSources, []);
	assert.equal(persisted.sourceBuffers.size, 1);
	assert.equal(persisted.sourcePeaks.size, 0);
});

test('audio imports create indexed tracks and preserve playable data after analysis failure', async () => {
	const fixture = createFixture();
	const service = createProjectImportService(fixture.runtime);
	const created = await service.importFile(file('new-track.mp3', 'audio/mpeg'), {
		destination: 'timeline', trackId: null, trackIndex: 1, timelineStartFrame: 3,
	});
	assert.match(created.trackId, /^track-/u);
	await fixture.finishDerivatives();

	fixture.options.peakFails = true;
	await service.importFile(file('broken.mp3', 'audio/mpeg'));
	await fixture.finishDerivatives();
	assert.equal(fixture.commands.length, 2);
	assert.equal(fixture.deletedSources.length, 0);
	assert.equal(fixture.sourcePeaks.size, 1);

	fixture.options.peakFails = false;
	fixture.options.writerFails = true;
	await assert.rejects(() => service.importFile(file('writer.mp3', 'audio/mpeg')), /write failed/u);
	assert.equal(fixture.calls.includes('writer-abort'), true);
});

function derivativeFixture() {
	const lifetime = new EditorControllerLifetime();
	const generation = new EditorProjectGeneration();
	const token = generation.activate('project');
	const source = { id: 'source', storageKey: 'source', contentSha256: 'a'.repeat(64) };
	const project = { sources: [source] };
	const peaks = new Map<string, unknown>(), protectedIds = new Set<string>();
	let generated = 0, published = 0;
	const options = { generate: async () => {}, save: async () => {} };
	const scheduler = createAudioImportDerivativeScheduler({
		lifetime, assertProject: value => generation.assertCurrent(value), getProject: () => project,
		protectedSourceIds: protectedIds, sourcePeaks: peaks, peakCacheKey: id => `peaks:${id}`,
		generatePeaks: async () => { generated++; await options.generate(); return { version: 1, channelCount: 1, levels: [] }; },
		store: { saveAnalysis: () => options.save() }, publish: () => { published++; },
	});
	const request: AudioImportDerivativeRequest = { source, projectToken: token, channels: [Float32Array.of(0.5)] };
	return { lifetime, generation, source, project, options, request, scheduler, peaks, protectedIds,
		generated: () => generated, published: () => published };
}
