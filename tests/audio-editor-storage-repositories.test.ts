/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type { StorageRepositoryFactory } from '../src/common/editor/storage/repositories.ts';

test('loadProject forwards the requested revision and cancellation signal to the project repository', async () => {
	const abortController = new AbortController();
	const loadedProject = { id: 'delegated-load-project', revision: 7 };
	let receivedProjectId: string | undefined;
	let receivedOptions: { revision?: number; signal?: AbortSignal } | undefined;
	const repositoryFactory = (() => ({
		projects: {
			load: async (
				projectId: string,
				options: { revision?: number; signal?: AbortSignal } = {},
			) => {
				receivedProjectId = projectId;
				receivedOptions = options;
				return loadedProject;
			},
		},
	})) as unknown as StorageRepositoryFactory;
	const store = new AudioEditorProjectStore({
		indexedDB: null,
		repositoryFactory,
	});

	assert.equal(await store.loadProject(loadedProject.id, {
		revision: loadedProject.revision,
		signal: abortController.signal,
	}), loadedProject);
	assert.equal(receivedProjectId, loadedProject.id);
	assert.equal(receivedOptions?.revision, loadedProject.revision);
	assert.equal(receivedOptions?.signal, abortController.signal);
});

test('clear and close coordinate the default repositories without reviving the facade', async () => {
	const store = new AudioEditorProjectStore({
		indexedDB: null,
		databaseName: `repository-clear-${Date.now()}-${Math.random()}`,
		preferOpfs: false,
	});
	await store.saveProject({ id: 'clear-project', revision: 0 });
	await store.saveSetting('theme', 'dark');
	await store.saveAnalysis('peaks', { maximum: 1 });
	await store.writeMediaAsset('clear-source', new Blob(['source']));

	await store.clear();
	assert.deepEqual(await store.listProjects(), []);
	assert.equal(await store.loadSetting('theme'), null);
	assert.equal(await store.loadAnalysis('peaks'), null);
	assert.equal(await store.getMediaAssetMetadata('clear-source'), null);

	await store.close();
	await store.close();
	assert.equal(store.getStatus().state, 'closed');
	await assert.rejects(store.listProjects(), { code: 'STORE_CLOSED' });
});
