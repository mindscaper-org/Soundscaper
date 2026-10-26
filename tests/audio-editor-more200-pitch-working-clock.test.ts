/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveClipTimePitchCachePlan } from '../src/common/editor/clip-time-pitch-cache.js';
import { estimateClipTimePitchRenderAdmission } from '../src/common/editor/clip-time-pitch-render-admission.ts';
import { clipSourceSpectrogramOptions } from '../src/common/editor/ui/inspector/clip-source-spectrogram-options.ts';
import { clipFixture, sourceFixture } from './helpers/clip-time-pitch-cache-fixture.js';

for (const reversed of [false, true]) for (const speedRatio of [1, .5]) {
	test(`higher project clock preserves pitch headroom without changing the source authority (reverse=${String(reversed)}, speed=${String(speedRatio)})`, async () => {
		const source = sourceFixture({ sampleRate: 12_000, frameCount: 120 });
		const clip = clipFixture({ sourceStartFrame: 15, sourceDurationFrames: 90, durationFrames: 360 / speedRatio, pitchCents: 1200, speedRatio, reversed });
		const previous = await deriveClipTimePitchCachePlan(clip, source);
		const plan = await deriveClipTimePitchCachePlan(clip, source, { projectSampleRate: 48_000 });
		assert.equal(plan.sampleRate, 48_000); assert.equal(plan.sourceFrameCount, 120);
		assert.deepEqual(plan.sourceRange, { startFrame: 15, frameCount: 90 }); assert.equal(plan.sourceIdentity.sampleRate, 12_000);
		assert.equal(plan.stages[0]!.inputFrames, 360); assert.equal(plan.outputFrames, 360 / speedRatio);
		assert.notEqual(plan.finalKey, previous.finalKey);
		assert.equal((await deriveClipTimePitchCachePlan(clip, { ...source, sampleRate: 24_000 }, { projectSampleRate: 48_000 })).stages[0]!.inputFrames, 180);
		const admission = estimateClipTimePitchRenderAdmission(plan, { chunkFrames: 1024, transferLoadedSourceChannels: true });
		assert.ok(admission.phases[0]!.sourceInputBytes >= (120 + 360) * 4);
	});
}
for (const pitchCents of [0, -1200]) test(`higher clock leaves existing non-positive pitch PCM plans unchanged (${String(pitchCents)}c)`, async () => {
	const source = sourceFixture({ sampleRate: 12_000 }); const clip = clipFixture({ pitchCents });
	assert.equal((await deriveClipTimePitchCachePlan(clip, source, { projectSampleRate: 48_000 })).finalKey,
		(await deriveClipTimePitchCachePlan(clip, source)).finalKey);
});

test('the processed Source Monitor can display programme pitch above the raw-source Nyquist', () => {
	assert.equal(clipSourceSpectrogramOptions(48_000, 12_000).maxFreq, 6000);
	assert.equal(clipSourceSpectrogramOptions(48_000, 12_000, true).maxFreq, 24_000);
});

interface RenderRequest {
	readonly channels: Float32Array[];
	readonly sampleRate: number;
	readonly selection: Readonly<{ startFrame: number; frameCount: number }>;
	readonly outputFrames: number;
}
for (const reversed of [false, true]) test(`working-clock cache publishes scaled PCM and retains exact raw source (reverse=${String(reversed)})`, async () => {
	const { createProjectStore } = await import('../src/common/editor/storage.js');
	const { ClipTimePitchRenderCacheCoordinator } = await import('../src/common/editor/clip-time-pitch-cache.js');
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	const source = sourceFixture({ sampleRate: 12_000, frameCount: 120 });
	const raw = new Float32Array(120).fill(5); raw.fill(.25, 15, 105); const original = raw.slice();
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([raw]); await writer.commit();
	const clip = clipFixture({ sourceStartFrame: 15, sourceDurationFrames: 90, durationFrames: 360, pitchCents: 1200, reversed });
	const calls: RenderRequest[] = [];
	const cache = new ClipTimePitchRenderCacheCoordinator({ store, chunkFrames: 1024, client: {
		async render(request: RenderRequest) {
			calls.push(request); return { channels: [request.channels[0]!.slice(request.selection.startFrame, request.selection.startFrame + request.outputFrames)] };
		},
	} });
	try {
		const entry = await cache.prepareCommittedOutput(clip, source, { projectSampleRate: 48_000 });
		assert.equal(calls.length, 1); assert.equal(calls[0]!.sampleRate, 48_000);
		assert.equal(calls[0]!.channels[0]!.length, 360); assert.deepEqual(calls[0]!.selection, { startFrame: 0, frameCount: 360 });
		assert.ok(calls[0]!.channels[0]!.every(value => value === .25), 'Unused source samples cannot enter the processed window.');
		assert.equal(entry.sampleRate, 48_000); assert.equal(entry.frameCount, 360);
		assert.deepEqual(raw, original);
		const channels = await cache.loadCommittedChannels(entry); assert.equal(channels[0]!.length, 360);
		assert.ok(channels[0]!.every((value: number) => value === .25));
	} finally { await cache.dispose(); await store.close(); }
});

test('resampled cache admission rejects before loading source PCM when the prepared allocation exceeds the existing budget', async () => {
	const { createProjectStore } = await import('../src/common/editor/storage.js');
	const { ClipTimePitchRenderCacheCoordinator } = await import('../src/common/editor/clip-time-pitch-cache.js');
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	const source = sourceFixture({ sampleRate: 12_000, frameCount: 120 });
	const clip = clipFixture({ sourceDurationFrames: 120, durationFrames: 480, pitchCents: 1200 });
	const plan = await deriveClipTimePitchCachePlan(clip, source, { projectSampleRate: 48_000 });
	const required = estimateClipTimePitchRenderAdmission(plan, { chunkFrames: 1024, transferLoadedSourceChannels: true }).usefulBinaryWorkingSet.bytes;
	let loads = 0, renders = 0;
	const cache = new ClipTimePitchRenderCacheCoordinator({ store, chunkFrames: 1024, maximumRenderWorkingBytes: required - 1,
		transferLoadedSourceChannels: true, loadSourceChannels: async () => { loads++; return [new Float32Array(120)]; },
		client: { async render() { renders++; return { channels: [new Float32Array(480)] }; } } });
	try {
		await assert.rejects(cache.prepareCommittedOutput(clip, source, { projectSampleRate: 48_000 }), { code: 'RENDER_MEMORY_LIMIT_EXCEEDED' });
		assert.equal(loads, 0); assert.equal(renders, 0); assert.equal(await store.getSourceMetadata(plan.cacheSourceId), null);
	} finally { await cache.dispose(); await store.close(); }
});

test('cancellation during sinc preparation cannot dispatch or publish a late working cache', async () => {
	const { createProjectStore } = await import('../src/common/editor/storage.js');
	const { ClipTimePitchRenderCacheCoordinator } = await import('../src/common/editor/clip-time-pitch-cache.js');
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	const source = sourceFixture({ sampleRate: 12_000, frameCount: 12_000 });
	const clip = clipFixture({ sourceDurationFrames: 12_000, durationFrames: 48_000, pitchCents: 1200 });
	const abort = new AbortController(); let renders = 0;
	const cache = new ClipTimePitchRenderCacheCoordinator({ store, chunkFrames: 1024,
		loadSourceChannels: async () => { setTimeout(() => abort.abort(), 0); return [new Float32Array(12_000).fill(.25)]; },
		client: { async render() { renders++; return { channels: [new Float32Array(48_000)] }; } } });
	try {
		await assert.rejects(cache.prepareCommittedOutput(clip, source, { projectSampleRate: 48_000, signal: abort.signal }), { name: 'AbortError' });
		assert.equal(renders, 0); assert.equal(cache.getLastValid(clip.id), null);
	} finally { await cache.dispose(); await store.close(); }
});

test('lower programme clocks retain the source processing rate and existing cache identity', async () => {
	const source = sourceFixture({ sampleRate: 48_000 }); const clip = clipFixture({ pitchCents: 1200 });
	const before = await deriveClipTimePitchCachePlan(clip, source);
	const lower = await deriveClipTimePitchCachePlan(clip, source, { projectSampleRate: 8000 });
	assert.equal(lower.sampleRate, 48_000); assert.equal(lower.finalKey, before.finalKey);
});
