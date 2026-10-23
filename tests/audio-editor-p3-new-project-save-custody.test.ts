/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createProjectSaveService, ProjectSaveConflictError } from '../src/common/editor/controller/document/project-save-service.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type Tab = Readonly<{ projectId: string; dirty: boolean }>;
for (const scenario of ['quota', 'healthy', 'collision'] as const) test(`File New initial-save custody: ${scenario}`, async context => {
	const fails = scenario !== 'healthy';
	const dom = installReactTestDom(); context.after(() => dom.restore());
	const listeners: Array<(event: BeforeUnloadEvent) => void> = [];
	Object.assign(window, { addEventListener(type: string, listener: (event: BeforeUnloadEvent) => void) {
		if (type === 'beforeunload') listeners.push(listener);
	} });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	let full = false;
	const quota = new DOMException('Project storage is full', 'QuotaExceededError');
	const wrapped = new Proxy(store, { get(target, key) {
		if (key === 'createProjectIfAbsent') return (...args: Parameters<typeof store.createProjectIfAbsent>) => {
			if (full) return Promise.reject(quota);
			return store.createProjectIfAbsent(...args);
		};
		const value: unknown = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
	} });
	const runtime = createSoundscaperProjectRuntimeSelection(), session = runtime.createSessionController();
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store: wrapped,
		projectRuntime: runtime, sessionController: session, engine: createMemoryEngine() as unknown as Options['engine'] });
	context.after(async () => { full = false; try { await controller.dispose(); } catch (error) { assert.ok(error instanceof ProjectSaveConflictError); } }); await controller.ready;
	const before = controller.project; assert.ok(before);
	full = fails;
	if (fails) await assert.rejects(controller.actions.project.create(), error => error === quota);
	else await controller.actions.project.create();
	const current = controller.project; assert.ok(current); assert.notEqual(current.id, before.id);
	assert.equal(controller.getSnapshot().readOnly, false, 'the admitted project remains editable');
	const tab = session.getSnapshot().tabs.find((tab: Tab) => tab.projectId === current.id); assert.ok(tab);
	assert.equal(tab.dirty, fails);
	assert.equal(controller.getSnapshot().save.state, fails ? 'dirty' : 'saved');
	assert.equal(await store.loadProject(current.id) === null, fails);
	let prevented = false;
	const event = { returnValue: undefined, preventDefault() { prevented = true; } } as unknown as BeforeUnloadEvent;
	for (const listener of listeners) listener(event);
	assert.equal(prevented, fails, 'unpublished project custody remains protected');
	full = false;
	if (scenario === 'collision') {
		const foreign = { ...current, title: 'Different owner published first' };
		await store.saveProject(foreign);
		await assert.rejects(controller.actions.project.save(), ProjectSaveConflictError);
		assert.equal(controller.getSnapshot().readOnly, true);
		assert.deepEqual(await store.loadProject(current.id), foreign, 'a retry cannot replace another publication');
		assert.equal(session.getSnapshot().tabs.find((tab: Tab) => tab.projectId === current.id)?.dirty, true);
		return;
	}
	await controller.actions.project.rename('Retry after storage is available');
	await controller.actions.project.save();
	const saved = await store.loadProject(current.id); assert.ok(validateSoundscaperProject(saved));
	assert.equal(saved.title, 'Retry after storage is available');
	assert.equal(session.getSnapshot().tabs.find((tab: Tab) => tab.projectId === current.id)?.dirty, false);
	assert.equal(controller.getSnapshot().save.state, 'saved');
});

for (const retirement of ['project', 'fence'] as const) test(`initial Save retry cannot publish after ${retirement} retirement`, async () => {
	let release = (): void => {}, started = (): void => {};
	const gate = new Promise<void>(resolve => { release = resolve; });
	const entering = new Promise<void>(resolve => { started = resolve; });
	const project = { id: 'unpublished-project' };
	let fence: string | null = 'owner';
	let created = false;
	const publications: string[] = [];
	const service = createProjectSaveService({
		getProject: () => project, hasHistory: () => true, isReadOnly: () => false, getWriteFence: () => fence,
		cloneProject: value => ({ ...value }), admitProjectPublication: async () => {},
		saveProject: async () => { throw new Error('Unconditional publication is forbidden'); },
		saveProjectIfCurrentWithWriteFence: async () => { throw new Error('No persisted baseline exists'); },
		createProjectIfAbsent: async (snapshot, options) => {
			started(); await gate; options.assertCurrent?.(); created = true; return snapshot;
		},
		persistActiveProjectId: async () => {}, isCurrentProject: () => true, hasSessionTab: () => true,
		markProjectSaved() {}, publish: state => { publications.push(state); },
		garbageCollect: async () => {}, refreshStorageUsage: async () => {}, handleError() {},
	});
	const pending = service.flushProject();
	await entering;
	if (retirement === 'project') { service.suspendProject(project.id); service.retireProjectSaves(project.id); }
	else fence = null;
	release(); await pending;
	assert.equal(created, false);
	assert.equal(service.getPersistedSnapshot(project.id), null);
	assert.ok(!publications.includes('saved'));
});

test('terminal Save drains one exact initial publication and then closes save admission', async () => {
	const project = { id: 'terminal-unpublished' };
	let created = 0;
	const service = createProjectSaveService({
		getProject: () => project, hasHistory: () => true, isReadOnly: () => false, getWriteFence: () => 'owner',
		cloneProject: value => ({ ...value }), admitProjectPublication: async () => {},
		saveProject: async () => { throw new Error('Unconditional publication is forbidden'); },
		saveProjectIfCurrentWithWriteFence: async () => { throw new Error('No persisted baseline exists'); },
		createProjectIfAbsent: async (snapshot, options) => { options.assertCurrent?.(); created++; return snapshot; },
		persistActiveProjectId: async () => {}, isCurrentProject: () => true, hasSessionTab: () => true,
		markProjectSaved() {}, publish() {}, garbageCollect: async () => {}, refreshStorageUsage: async () => {}, handleError() {},
	});
	await service.terminalFlush();
	assert.equal(created, 1);
	assert.deepEqual(service.getPersistedSnapshot(project.id), project);
	assert.equal(service.flushProject(), undefined);
	assert.equal(service.scheduleAutosave(), false);
});
