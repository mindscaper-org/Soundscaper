/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
type Tab = Readonly<{ projectId: string; dirty: boolean }>;
for (const operation of ['new', 'close-active', 'close-inactive'] as const) for (const changed of [false, true]) test(`${operation} protects a retained ${changed ? 'dirty' : 'saved'} read-only project`, async context => {
	const dom = installReactTestDom(); context.after(() => dom.restore());
	const listeners: Array<(event: BeforeUnloadEvent) => void> = [];
	Object.assign(window, { addEventListener(type: string, listener: (event: BeforeUnloadEvent) => void) {
		if (type === 'beforeunload') listeners.push(listener);
	} });
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
		await controller.actions.project.rename('Unsaved narration');
		await assert.rejects(controller.actions.project.flush(), error => error === quota);
	}
	hasLost = true; lose();
	for (let attempt = 0; attempt < 100 && !controller.getSnapshot().readOnly; attempt++) await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(controller.getSnapshot().readOnly, true);
	assert.equal(session.getSnapshot().tabs.find((tab: Tab) => tab.projectId === firstId)?.dirty, changed);
	rejectProjectSave = false;
	if (operation === 'close-active') { await closeRetainedProject(); return; }
	await controller.actions.project.create({ title: 'Clean incoming project' });
	assert.notEqual(controller.project?.id, firstId);
	assert.equal(controller.getSnapshot().readOnly, false);
	assert.equal(session.getSnapshot().tabs.find((tab: Tab) => tab.projectId === firstId)?.dirty, changed);
	assert.equal(session.getSnapshot().tabs.find((tab: Tab) => tab.projectId === controller.project?.id)?.dirty, false);
	if (operation === 'close-inactive') { await closeRetainedProject(); return; }
	let prevented = false;
	const event = { returnValue: undefined, preventDefault() { prevented = true; } } as unknown as BeforeUnloadEvent;
	for (const listener of listeners) listener(event);
	assert.equal(prevented, changed, 'retained unsaved history must remain protected when a different clean project is active');
	async function closeRetainedProject(): Promise<void> {
		if (changed) await assert.rejects(controller.actions.project.close(firstId), /read.only/iu);
		else await controller.actions.project.close(firstId);
		assert.equal(session.getSnapshot().tabs.some((tab: Tab) => tab.projectId === firstId), changed);
	}
});
