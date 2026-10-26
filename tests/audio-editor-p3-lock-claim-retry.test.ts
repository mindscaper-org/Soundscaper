/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { ProjectLifecycleLock } from '../src/common/editor/controller/document/project-lifecycle-types.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

for (const failure of ['acquisition', 'write-fence'] as const) {
	test(`P3-013: failed ${failure} retains the public project-lock retry route`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const project = createSoundscaperProject({ id: 'contested', title: 'Contested' });
		await store.saveProject(project);
		const expected = new Error('Temporary lock storage failure');
		let claims = 0;
		let opened = false;
		let rejectFence = false;
		const controllerStore = new Proxy(store, { get(target, key) {
			if (key === 'claimProjectWriteFence') return async (id: string) => {
				if (rejectFence) { rejectFence = false; throw expected; }
				return store.claimProjectWriteFence(id);
			};
			const value: unknown = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		} });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, {
			headless: true, locale: 'en', copy: COPY,
			store: controllerStore,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			async acquireProjectLock(id, options): Promise<ProjectLifecycleLock> {
				if (id === project.id && opened && options?.force) {
					claims += 1;
					if (claims === 1 && failure === 'acquisition') throw expected;
					if (claims === 1 && failure === 'write-fence') rejectFence = true;
				}
				return { projectId: id, readOnly: id === project.id && !opened,
					method: 'test-lock', retryAt: Date.now() + 60_000, release() {} };
			},
		});
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.project.openById(project.id);
		opened = true;
		assert.equal(controller.project?.id, project.id);
		assert.equal(controller.getSnapshot().readOnly, true);
		assert.equal(controller.getSnapshot().lockReadOnly, true);
		await assert.rejects(controller.actions.project.claimLock(), error => error === expected);
		assert.equal(controller.getSnapshot().readOnly, true);
		assert.equal(controller.getSnapshot().lockReadOnly, true, 'the Claim project lock menu/toast remains available');
		assert.equal(await controller.actions.project.claimLock(), true, 'retry can obtain a healthy lock');
		assert.equal(claims, 2);
		assert.equal(controller.getSnapshot().readOnly, false);
		assert.equal(controller.getSnapshot().lockReadOnly, false);
		await controller.actions.project.rename('Recovered editing');
		await controller.actions.project.save();
		const saved: unknown = await store.loadProject(project.id);
		assert.ok(saved && typeof saved === 'object' && 'title' in saved);
		assert.equal(saved.title, 'Recovered editing');
	});
}
