/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperPersistentDeliveryUiService, type SoundscaperPersistentDeliveryRendererBridge } from '../src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-ui-service.ts';

function fixture() {
	let lists = 0;
	let publishes = 0;
	let sequence = 0;
	let paused = false;
	let revision = 1;
	let blockList: (() => Promise<void>) | undefined;
	const bridge: SoundscaperPersistentDeliveryRendererBridge = {
		selectDestination: async () => null, reauthorizeDestination: async () => null,
		currentProjectIdentity: async () => ({ projectId: 'project', projectRevision: revision, projectSha256: 'ab'.repeat(32) }),
		enqueueBatch: async () => [],
		list: async () => { lists++; await blockList?.(); return { entries: [], paused, nextCursor: null }; },
		events: async ({ afterSequence }) => ({ events: sequence > afterSequence ? [{ sequence }] : [], nextSequence: sequence, hasMore: false }),
		pause: async () => { paused = true; sequence++; }, resume: async () => { paused = false; sequence++; },
		reorder: async () => undefined, cancel: async () => undefined, retry: async () => undefined,
	};
	const service = createSoundscaperPersistentDeliveryUiService({ bridge,
		getProject: () => ({ id: 'project', revision, title: 'Project' }), getSaveState: () => 'saved',
		captureProjectGeneration: () => ({ generation: 1, projectId: 'project' }), assertProjectGeneration() {},
		describeMember: async () => ({ settings: {}, exportPlan: {} }), publishDocumentSnapshot: () => { publishes++; },
	});
	return { service, bridge, get lists() { return lists; }, get publishes() { return publishes; },
		setBlock(callback?: () => Promise<void>) { blockList = callback; },
		editProject() { revision++; }, changeQueue() { sequence++; },
	};
}

test('simultaneous observational refreshes share one queue read instead of draining a poll backlog', async () => {
	const state = fixture();
	let release!: () => void;
	const blocked = new Promise<void>(resolve => { release = resolve; });
	state.setBlock(() => blocked);
	const operations = Array.from({ length: 20 }, () => state.service.refresh());
	release();
	await Promise.all(operations);
	assert.equal(state.lists, 1);
});

test('unchanged queue polling retains the view and skips full pagination and publication', async () => {
	const state = fixture();
	await state.service.refresh();
	const view = state.service.list();
	const published = state.publishes;
	for (let index = 0; index < 5; index++) await state.service.refresh();
	assert.equal(state.lists, 1);
	assert.equal(state.publishes, published);
	assert.strictEqual(state.service.list(), view);
	state.changeQueue();
	await state.service.refresh();
	assert.equal(state.lists, 2);
	assert.strictEqual(state.service.list(), view, 'an event with no visible difference retains the mirror');
	state.editProject();
	await state.service.refresh();
	assert.equal(state.lists, 3, 'a changed saved project must re-evaluate relative queue states');
});

test('a mutation waits for any older refresh and then observes its committed state', async () => {
	const state = fixture();
	let release!: () => void;
	let entered!: () => void;
	const started = new Promise<void>(resolve => { entered = resolve; });
	const blocked = new Promise<void>(resolve => { release = resolve; });
	state.setBlock(async () => { entered(); await blocked; });
	const refresh = state.service.refresh();
	await started;
	const mutation = state.service.pause();
	state.setBlock(); release();
	await Promise.all([refresh, mutation]);
	assert.equal(state.service.list().paused, true);
	assert.equal(state.lists, 2, 'the mutation must not accept an older in-flight read as its freshness barrier');
});
