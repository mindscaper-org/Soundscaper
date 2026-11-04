/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
	COPY,
	createAudioEditorController,
	createMemoryClipTimePitchCache,
	createProjectStore,
	installSelectionPreviewFixture,
} from './helpers/audio-editor-controller-harness.js';
import { deferred } from './helpers/async-test-control.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

test('the composed editor waits for replacement PCM before applying a pitch edit during playback', async () => {
	const { controller, engine, cache } = await playbackFixture();
	const gate = deferred<void>();
	try {
		engine.state = 'playing';
		cache.queuePlayback({ stale: true, revision: 'fresh', gate });

		controller.actions.clip.update('selection-preview-clip', { pitchCents: 200 });
		await nextTurn();
		assert.equal(cache.resolveCalls.length, 1);
		assert.equal(engine.appliedProjects.length, 0, 'old playback remains active while its replacement is rendering');

		gate.resolve();
		await nextTurn();
		assert.ok(cache.getCommitted('cache-fresh')?.audioBuffer);
		assert.equal(engine.appliedProjects.length, 1, 'the fresh snapshot is applied once');
		assert.equal(engine.appliedProjects[0]?.clips?.[0]?.pitchCents, 200);
	} finally {
		gate.resolve();
		await controller.dispose();
	}
});

for (const action of ['pause', 'stop'] as const) test(`${action} during replacement rendering keeps the edit available for the next Play`, async () => {
	const { controller, engine, cache } = await playbackFixture();
	const gate = deferred<void>();
	try {
		engine.state = 'playing';
		cache.queuePlayback({ stale: true, revision: 'replacement', gate });
		controller.actions.clip.update('selection-preview-clip', { pitchCents: 200 });
		await nextTurn();
		assert.equal(engine.appliedProjects.length, 0);

		if (action === 'stop') await controller.actions.transport.stop();
		else await controller.actions.transport.playPause();
		await nextTurn();
		assert.equal(engine.state, action === 'stop' ? 'stopped' : 'paused');
		assert.equal(engine.appliedProjects.at(-1)?.clips?.[0]?.pitchCents, 200);
		await controller.actions.transport.playPause();
		assert.equal(engine.state, 'playing');
		assert.equal(engine.appliedProjects.at(-1)?.clips?.[0]?.pitchCents, 200);
	} finally {
		gate.resolve();
		await controller.dispose();
	}
});

for (const followup of ['selection', 'rename'] as const) test(`a ${followup} change carries a transport-owned background render into the next playback snapshot`, async () => {
	const { controller, engine, cache } = await playbackFixture();
	const gate = deferred<void>();
	try {
		controller.actions.clip.update('selection-preview-clip', { pitchCents: 200 });
		await nextTurn();
		engine.appliedProjects.length = 0;
		cache.queuePlayback({ stale: true, revision: 'background', gate });
		cache.queuePlayback({ stale: true, revision: 'replacement', gate });
		await controller.actions.transport.playPause();
		assert.equal(engine.state, 'playing');
		if (followup === 'selection') controller.actions.timeline.setSelection(0, 2_400);
		else controller.actions.clip.update('selection-preview-clip', { title: 'Renamed during render' });
		await nextTurn();
		assert.equal(cache.resolveCalls.length, 2, 'the document change carries the unfinished render forward');
		assert.equal(engine.appliedProjects.length, 0);
		gate.resolve();
		await nextTurn();
		assert.equal(engine.appliedProjects.length, 1);
		assert.equal(engine.appliedProjects[0]?.clips?.[0]?.pitchCents, 200);
	} finally {
		gate.resolve();
		await controller.dispose();
	}
});

async function playbackFixture() {
	const context = new MockAudioContext();
	const engine = Object.assign(createAudioEditorEngine({
		audioContextFactory: () => context as unknown as EngineAudioContext,
	}), { appliedProjects: [] as EngineProject[], state: 'stopped' });
	engine.applyProject = async project => { if (project) engine.appliedProjects.push(project); };
	engine.play = async () => { engine.state = 'playing'; };
	const resolver = Object.assign(() => null, { snapshot: () => () => null });
	const memoryCache = createMemoryClipTimePitchCache();
	const cache = {
		createEngineSourceResolver: () => resolver,
		prepareCommittedOutput: memoryCache.prepareCommittedOutput.bind(memoryCache),
		resolveForPlayback: memoryCache.resolveForPlayback.bind(memoryCache),
		loadCommittedChannels: memoryCache.loadCommittedChannels.bind(memoryCache),
		getCommitted: memoryCache.getCommitted.bind(memoryCache),
		attachAudioBuffer: memoryCache.attachAudioBuffer.bind(memoryCache),
		getProtectedSourceIds: memoryCache.getProtectedSourceIds.bind(memoryCache),
		queuePlayback: memoryCache.queuePlayback.bind(memoryCache),
		resolveCalls: memoryCache.resolveCalls,
		async dispose() { memoryCache.dispose(); },
	};
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `edit-playback-${randomUUID()}` });
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, store, engine, clipTimePitchCache: cache,
	});
	await controller.ready;
	const writer = await store.beginSourceWrite('selection-preview-source', { sampleRate: 48_000, channelCount: 1 });
	await writer.write([new Float32Array(4_800)]);
	await writer.commit();
	installSelectionPreviewFixture(controller);
	await nextTurn();
	engine.appliedProjects.length = 0;
	return { controller, engine, cache };
}
