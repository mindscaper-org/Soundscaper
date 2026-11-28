/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createSoundscaperEditorProjectEnvironment } from '../src/soundscaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createSoundscaperCompatibilityController } from './helpers/soundscaper-controller-session.ts';

test('the shared controller exposes no desktop macro file batch action', async () => {
	const environment = await createEnvironment();
	const fileService = createAudioEditorFileService({ bridge: {} });
	const controller = createSoundscaperCompatibilityController(environment, { fileService });
	try {
		await controller.ready;
		assert.equal(fileService.isDesktop, true);
		assert.equal(Reflect.has(controller.actions.macros, 'applyToFiles'), false);
	} finally {
		try { await controller.dispose(); } finally { await environment.close(); }
	}
});

test('the shared controller closes edit authority before awaiting disposal', async () => {
	const environment = await createEnvironment();
	const controller = createSoundscaperCompatibilityController(environment);
	try {
		await controller.ready;
		let nested: Promise<void> | undefined;
		const unsubscribe = controller.subscribe(() => {
			if (controller.getSnapshot().phase === 'disposing') nested = controller.dispose();
		});
		const pending = controller.dispose();
		assert.equal(nested, pending);
		unsubscribe();
		assert.equal(controller.getSnapshot().phase, 'disposing');
		assert.throws(() => controller.actions.project.create(), { code: 'DISPOSED' });
		assert.throws(() => controller.actions.edit.commit({ type: 'project/rename', title: 'Retired' }), { code: 'DISPOSED' });
		await pending;
	} finally {
		await controller.dispose().catch(() => undefined);
		await environment.close();
	}
});

test('explicit early disposal fencing also closes project edits', async () => {
	const environment = await createEnvironment();
	const controller = createSoundscaperCompatibilityController(environment);
	try {
		await controller.ready;
		controller.beginDisposal();
		assert.equal(controller.getSnapshot().phase, 'disposing');
		assert.throws(() => controller.actions.project.create(), { code: 'DISPOSED' });
		assert.throws(() => controller.actions.edit.commit({ type: 'project/rename', title: 'Retired' }), { code: 'DISPOSED' });
	} finally {
		await controller.dispose().catch(() => undefined);
		await environment.close();
	}
});

function createEnvironment() {
	return createSoundscaperEditorProjectEnvironment({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB(),
			preferOpfs: false,
			storageManager: {
				estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
				persisted: async () => true,
				persist: async () => true,
			} as unknown as StorageManager,
		},
	});
}
