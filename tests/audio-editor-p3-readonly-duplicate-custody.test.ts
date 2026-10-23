/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
type Tab = Readonly<{ projectId: string; dirty: boolean }>;
for (const changed of [false, true]) test(`Duplicate protects ${changed ? 'dirty' : 'saved'} read-only snapshot`, async context => {
	const dom = installReactTestDom(); context.after(() => dom.restore());
	let lose = (): void => {}; const lost = new Promise<void>(resolve => { lose = resolve; });
	let hasLost = false, rejectProjectSave = false, firstId = '';
	const runtime = createSoundscaperProjectRuntimeSelection(), session = runtime.createSessionController();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const quota = new DOMException('Project storage is full', 'QuotaExceededError');
	const controllerStore = new Proxy(store, { get(target, key) {
		if (key === 'saveProjectIfCurrentWithWriteFence') return (...args: Parameters<typeof store.saveProjectIfCurrentWithWriteFence>) => {
			if (rejectProjectSave) return Promise.reject(quota);
			return store.saveProjectIfCurrentWithWriteFence(...args);
		};
		const value: unknown = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
	} });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store: controllerStore,
		projectRuntime: runtime, sessionController: session, engine: createMemoryEngine() as unknown as Options['engine'],
		acquireProjectLock: async projectId => {
			if (!firstId) firstId = projectId;
			return { projectId, readOnly: hasLost && projectId === firstId, method: 'test',
				...(projectId === firstId && !hasLost ? { lost } : {}), retryAt: Date.now() + 60_000, release() {} };
		} });
	context.after(async () => { lose(); try { await controller.dispose(); } catch (error) { assert.equal(error, quota); } }); await controller.ready;
	await controller.actions.project.save();
	if (changed) {
		rejectProjectSave = true;
		controller.actions.track.update(controller.project!.tracks[0]!.id, { name: 'Unsaved track' });
		await assert.rejects(controller.actions.project.flush(), error => error === quota);
	}
	hasLost = true; lose();
	for (let attempt = 0; attempt < 100 && !controller.getSnapshot().readOnly; attempt++) await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(controller.getSnapshot().readOnly, true);
	assert.equal(session.getSnapshot().tabs.find((tab: Tab) => tab.projectId === firstId)?.dirty, changed);
	rejectProjectSave = false;
	const before = controller.project;
	const history = session.captureProjectHistory(firstId);
	const catalog = await store.listProjects();
	if (changed) {
		await assert.rejects(controller.actions.project.duplicate('Visible copy'), /read.only/iu);
		assert.equal(controller.project, before, 'refusal retains the unsaved canonical snapshot');
		assert.deepEqual(session.captureProjectHistory(firstId), history, 'the complete undo history remains retained');
		assert.equal(session.getSnapshot().tabs.find((tab: Tab) => tab.projectId === firstId)?.dirty, true);
		assert.deepEqual(await store.listProjects(), catalog, 'no misleading copy is published');
		const durable = await store.loadProject(firstId);
		assert.ok(validateSoundscaperProject(durable));
		assert.notEqual(durable.tracks[0]?.name, 'Unsaved track');
	} else {
		const duplicated = await controller.actions.project.duplicate('Visible copy');
		assert.ok(duplicated);
		assert.equal(controller.project?.title, 'Visible copy');
		assert.equal(controller.project?.tracks[0]?.name, before?.tracks[0]?.name);
		assert.equal((await store.listProjects()).length, catalog.length + 1);
	}
});
