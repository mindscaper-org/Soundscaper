/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { ordinaryImageResourceFixture } from './helpers/ordinary-image-resource-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const format of ['png', 'jpeg', 'gif', 'webp', 'bmp'] as const) test(`Add Images refuses oversized ${format} before allocation without changing controller/history/store`, async context => {
	const encoded = ordinaryImageResourceFixture(format === 'png' ? 'png-large' : `${format}-wide`);
	const file = new File([Uint8Array.from(encoded)], `ordinary.${format}`, { type: `image/${format}` });
	const originalDecoder = Object.getOwnPropertyDescriptor(globalThis, 'ImageDecoder');
	let allocations = 0, selected = 0, reads = 0;
	class AllocationSentinel {
		static async isTypeSupported(): Promise<boolean> { return true; }
		constructor() { allocations++; throw new Error('No oversized raster may reach an allocating decoder.'); }
	}
	Object.defineProperty(globalThis, 'ImageDecoder', { configurable: true, value: AllocationSentinel });
	context.after(() => {
		if (originalDecoder) Object.defineProperty(globalThis, 'ImageDecoder', originalDecoder);
		else Reflect.deleteProperty(globalThis, 'ImageDecoder');
	});
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment, { fileService: {
		...createAudioEditorFileService(), isDesktop: true,
		chooseFiles: async () => { selected++; return [{ id: 'selected-encoded-image' }]; },
		async withReadDescriptors<Result>(_descriptors: readonly unknown[], _request: unknown,
			consume: (files: readonly File[]) => PromiseLike<Result> | Result): Promise<Result> { reads++; return await consume([file]); },
	} });
	context.after(async () => { try { await controller.dispose(); } finally { await environment.close(); } });
	await controller.ready; await controller.actions.project.flush();
	const before = cloneFramescaperProject(PROFILE, controller.project);
	const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(runtime);
	await assert.rejects(runtime.run('video-still'), format === 'png' ? /pixels exceed the per-frame limit/u : /Image width.*8192/u);
	assert.equal(selected, 1); assert.equal(reads, 1); assert.equal(allocations, 0);
	assert.deepEqual(cloneFramescaperProject(PROFILE, controller.project), before);
	assert.deepEqual(cloneFramescaperProject(PROFILE, await environment.store.loadProject(before.id)), before);
	assert.equal(before.sources.length, 0); assert.equal(before.clips.length, 0);
	controller.actions.edit.undo(); assert.deepEqual(cloneFramescaperProject(PROFILE, controller.project), before);
	controller.actions.edit.redo(); assert.deepEqual(cloneFramescaperProject(PROFILE, controller.project), before);
	await controller.actions.project.flush();
	assert.deepEqual(cloneFramescaperProject(PROFILE, await environment.store.loadProject(before.id)), before);
});
