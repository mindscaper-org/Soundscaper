/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ClipTimePitchRenderCacheCoordinator } from '../src/common/editor/clip-time-pitch-cache.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { normalizeStaffPadRenderRequest } from '../src/common/editor/staffpad/parameters.js';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';

for (const reopen of [false, true]) test(`linked changed-content relink replaces pitched PCM with cache reopened=${reopen}`, async context => {
	const source = createAudioSource({ id: 'linked', storageKey: 'linked', mimeType: 'audio/wav', frameCount: 4096,
		channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000, chunkFrames: 65_536 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount,
		sourceDurationFrames: source.frameCount, pitchCents: 300 });
	const old = wav(.25), next = wav(-.5);
	const snapshots = new Map([['original_locator_00001', { blob: old, locatorRevision: 'original_revision_00001' }],
		['replacement_locator_001', { blob: next, locatorRevision: 'replacement_revision_001' }]]);
	const port: LinkedOriginalPort = { load(_kind, id) { return snapshots.get(id) ?? null; }, release() { return true; } };
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, storageManager: null,
		databaseName: `linked-pitch-relink-${reopen}-${Date.now()}`, linkedOriginalPort: port });
	await store.ready();
	let renders = 0;
	const client = { render(request: unknown) {
		renders++;
		const normalized = normalizeStaffPadRenderRequest(request);
		return Promise.resolve({ channels: normalized.channels.map(channel => channel.slice()) });
	} };
	let cache = new ClipTimePitchRenderCacheCoordinator({ store, client });
	context.after(async () => { await cache.dispose(); await store.close(); });
	const binding = await store.bindLinkedAudioOriginal('project', source, 'original_locator_00001', {
		expectedLocatorRevision: 'original_revision_00001', expectedSnapshot: old });
	const first = await cache.prepareCommittedOutput(clip, source);
	assert.equal((await cache.loadCommittedChannels(first))[0]![0], .25);
	assert.equal(renders, 1);
	await store.relinkLinkedAudioOriginal('project', source, 'replacement_locator_001', {
		admission: 'changed-content', expectedBindingToken: binding.bindingToken,
		expectedLocatorRevision: 'replacement_revision_001', expectedSnapshot: next });
	if (reopen) { await cache.dispose(); cache = new ClipTimePitchRenderCacheCoordinator({ store, client }); }
	const request = await cache.requestClipRender(clip, source);
	assert.equal(request.current, null, 'playback must wait instead of auditioning the old linked content during refresh');
	const replaced = request.committed ?? await request.pending;
	assert.equal((await cache.loadCommittedChannels(replaced))[0]![0], -.5, 'a retained source ID cannot reuse audio from the previous linked content');
	assert.notEqual(replaced.cacheKey, first.cacheKey);
	assert.equal(renders, 2);
});

test('exact linked-file relocation reuses its content-identical pitch cache', async context => {
	const source = createAudioSource({ id: 'linked', storageKey: 'linked', mimeType: 'audio/wav', frameCount: 4096,
		channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000, chunkFrames: 65_536 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount,
		sourceDurationFrames: source.frameCount, pitchCents: 100 });
	const blob = wav(.25);
	const port: LinkedOriginalPort = { load(_kind, id) { return { blob, locatorRevision: `${id}_revision` }; }, release() { return true; } };
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, storageManager: null,
		databaseName: `linked-pitch-exact-${Date.now()}`, linkedOriginalPort: port });
	await store.ready();
	let renders = 0;
	const cache = new ClipTimePitchRenderCacheCoordinator({ store, client: { render(request: unknown) {
		renders++; return Promise.resolve({ channels: normalizeStaffPadRenderRequest(request).channels.map(channel => channel.slice()) });
	} } });
	context.after(async () => { await cache.dispose(); await store.close(); });
	const binding = await store.bindLinkedAudioOriginal('project', source, 'original_locator_00001', { expectedSnapshot: blob });
	const first = await cache.prepareCommittedOutput(clip, source);
	await store.relinkLinkedAudioOriginal('project', source, 'replacement_locator_001', {
		expectedBindingToken: binding.bindingToken, expectedLocatorRevision: 'replacement_locator_001_revision', expectedSnapshot: blob });
	const next = await cache.prepareCommittedOutput(clip, source);
	assert.equal(next.cacheKey, first.cacheKey); assert.equal(renders, 1);
});

function wav(value: number): Blob {
	const bytes = encodeWav([new Float32Array(4096).fill(value)], { sampleRate: 48_000, float: true, dither: 'none' });
	assert.ok(bytes instanceof Uint8Array);
	return new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' });
}
