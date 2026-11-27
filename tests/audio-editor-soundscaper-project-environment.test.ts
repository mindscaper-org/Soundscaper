/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperEditorProjectEnvironment } from
	'../src/soundscaper/editor-project-environment.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const GLOBAL_NAME = 'soundscaperProjectLibraryDesktop';

test('the retained store works without consulting the retired desktop bridge', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	let accessed = false;
	Object.defineProperty(globalThis, GLOBAL_NAME, {
		configurable: true,
		enumerable: true,
		get() { accessed = true; throw new Error('desktop bridge accessor ran'); },
	});
	try {
		const environment = await createSoundscaperEditorProjectEnvironment({ storeOptions: storeOptions() });
		try {
			const project = createSoundscaperProject({ id: 'local-recovery-environment' });
			assert.deepEqual(await environment.createProjectIfAbsent(project), project);
		} finally { await environment.close(); }
		assert.equal(accessed, false);
	} finally { restore(previous); }
});

function storeOptions() {
	return {
		indexedDB: createInstrumentedIndexedDB(),
		preferOpfs: false,
		storageManager: {
			estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
			persisted: async () => true,
			persist: async () => true,
		} as unknown as StorageManager,
	};
}

function restore(previous: PropertyDescriptor | undefined): void {
	if (previous) Object.defineProperty(globalThis, GLOBAL_NAME, previous);
	else Reflect.deleteProperty(globalThis, GLOBAL_NAME);
}
