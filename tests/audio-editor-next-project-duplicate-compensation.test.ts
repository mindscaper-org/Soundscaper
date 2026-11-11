/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { recordingRoutingSettingKey } from '../src/common/editor/recording-routing.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createProjectAdminService } from '../src/common/editor/controller/document/project-admin-service.ts';
import { createFixture as createAdminFixture } from './audio-editor-project-admin-service-fixture.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { createAudacityActionRuntime, createAudioEditorUiActionController } from '../src/common/editor/audacity-action-runtime.js';
import { findMenuItem } from './helpers/application-menu-fixture.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
interface MenuEntry {
	readonly id?: unknown;
	readonly items?: readonly MenuEntry[];
	readonly disabled?: unknown;
	readonly label?: unknown;
	readonly onClick?: unknown;
}
for (const changedCopy of [false, true]) test(`NP058: failed Duplicate routing ${changedCopy ? 'preserves an independently changed copy' : 'leaves no orphan project'}`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const saveSetting = store.saveSetting.bind(store);
	let rejectCopiedRouting = false;
	let originalId = '';
	Object.defineProperty(store, 'saveSetting', { value: async (key: string, value: unknown) => {
		if (rejectCopiedRouting && key.startsWith('recording-input-routing-v1:') && key !== recordingRoutingSettingKey(originalId)) {
			if (changedCopy) {
				const copy: unknown = await store.loadProject(key.slice('recording-input-routing-v1:'.length));
				assert.ok(validateSoundscaperProject(copy));
				await store.saveProject(applySoundscaperProjectCommand(copy, { type: 'project/rename', title: 'Independently changed copy' }));
			}
			throw new DOMException('The copied routing cannot be stored.', 'QuotaExceededError');
		}
		return saveSetting(key, value);
	} });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.rename('Interview'); await controller.actions.project.save();
	originalId = controller.project?.id ?? ''; assert.ok(originalId);
	const before = structuredClone(await store.listProjects());
	const project = controller.project;
	rejectCopiedRouting = true;
	await assert.rejects(controller.actions.project.duplicate('Interview copy'), /copied routing cannot be stored/u);
	assert.equal(controller.project, project);
	if (changedCopy) {
		assert.equal((await store.listProjects()).filter(row => row.title === 'Independently changed copy').length, 1);
	} else assert.deepEqual(await store.listProjects(), before, 'failed duplication must not leave a hidden durable copy');
	rejectCopiedRouting = false;
	await controller.actions.project.duplicate('Interview copy');
	assert.notEqual(controller.project?.id, originalId);
	assert.equal(controller.project?.title, 'Interview copy');
	assert.equal((await store.listProjects()).filter(row => row.title === 'Interview copy').length, 1);
});


test('NP058: duplicate compensation reports both required-write and cleanup failures', async () => {
	const fixture = createAdminFixture();
	const writeFailure = new Error('Required routing write failed.');
	const cleanupFailure = new Error('Conditional project cleanup failed.');
	const service = createProjectAdminService({ ...fixture.runtime,
		persistSetting: async () => { throw writeFailure; },
		store: { ...fixture.runtime.store, deleteProjectIfCurrent: async () => { throw cleanupFailure; } },
	});
	await assert.rejects(service.duplicateProject('Copy'), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [writeFailure, cleanupFailure]);
		assert.equal(error.cause, cleanupFailure);
		return true;
	});
});

function productionMenus(controller: Awaited<ReturnType<typeof controllerSession>>['controller'], fixture: ReturnType<typeof mountControllerDataDom>, parity: ReturnType<typeof createAudacityActionRuntime>) {
	const snapshot = controller.getSnapshot(), project = snapshot.project;
	const ui = parity.uiController.actions;
	const surface = (id: string) => ui.openSurface(id, {});
	const request = (type: string, value?: unknown) => ui.issue(type, { value });
	const panel = (id: string) => controller.actions.preferences.setPanelVisibility(id, true);
	return createWorkspaceApplicationMenus({
		aboutLabel: 'About Soundscaper', aup4InputRef: { current: null }, importInputRef: { current: null },
		blocked: false, editBlocked: false, handoffBlocked: false, capabilities: snapshot.capabilities, compactLayout: false,
		controller, copy: ENGLISH_COPY, crossProductHandoffAvailable: false, desktopHostRuntime: null,
		durationFrames: 0, fileService: { isDesktop: false }, locale: 'en', parityRuntime: parity, productId: 'soundscaper', project,
		projectBinEffectivelyOpen: true, recordLabel: ENGLISH_COPY.record, run: fixture.run, selectedClip: null, selectedAudioTrack: null,
		selectionActive: false, showArmControls: false, snapshot, soundscaperWorkflow: undefined,
		uiFlags: parity.uiController.getSnapshot().flags,
		executeEdit: (id: string) => {
			const operation: unknown = Reflect.get(controller.actions.edit, id); assert.ok(typeof operation === 'function');
			return Reflect.apply(operation, controller.actions.edit, []);
		},
		openDesktopFiles: () => request('open-files'), openProjectFile: undefined,
		openEffects: () => surface('effects'), openAssistanceSearch: undefined, openExternal: (url: string) => ui.openExternal(url),
		openGenerator: (type: string) => ui.openSurface('generator', { type }), openProjects: () => surface('projects'),
		openSelectionEffect: (type: string) => ui.openSurface('selection-effect', { type }),
		openSpectralSelection: () => surface('spectral-selection'), openSurface: surface,
		openTimedRecording: () => surface('timed-recording'), openTrackRate: () => surface('track-rate'), openWorkspacePanel: panel,
		setDialog: surface, setDialogValue: (value: unknown) => request('dialog-value', value),
		setNyquistTarget: (value: unknown) => request('nyquist-target', value),
		setShowArmControls: (value: unknown) => request('arm-controls', value),
		toggleFullscreen: () => request('fullscreen'), toggleRecording: () => request('record'),
		toggleWorkspacePanel: (id: string) => request('toggle-workspace-panel', id),
		zoomProject: (direction: string) => direction === 'in' ? controller.actions.timeline.zoomIn() : controller.actions.timeline.zoomOut(),
	});
}


test('default Duplicate menu rolls back a failed product IndexedDB routing put, then retries without hidden copies', { timeout: 15_000 }, async context => {
	const indexedDB = createInstrumentedIndexedDB();
	const store = createSoundscaperProjectStore({ indexedDB, preferOpfs: false });
	let enabled = false, failures = 0, originalId = '';
	const { controller } = await controllerSession(context, { store, engineFactory: () => { assert.fail('Empty project duplication must not render audio.'); } });
	await controller.actions.project.flush({ forceCurrentSnapshot: true });
	originalId = controller.project?.id ?? ''; assert.ok(originalId);
	assert.equal(controller.project?.title, 'Untitled project');
	const before = structuredClone(await store.loadProject(originalId));
	assert.deepEqual((await store.listProjects()).map(row => row.id), [originalId]);
	const history = structuredClone(controller.getSnapshot().history);
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = (indexedDB as unknown as IDBFactory).open(store.databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => resolve(opening.result as unknown as IDBDatabase);
	});
	const prototype = Object.getPrototypeOf(database.transaction('settings', 'readwrite').objectStore('settings')) as IDBObjectStore;
	const put = prototype.put;
	// The original browser fault is synchronous at put(), before a request exists.
	prototype.put = function (record: unknown, ...args: [IDBValidKey?]) {
		if (enabled && record && typeof record === 'object' && 'key' in record && typeof record.key === 'string'
			&& record.key.startsWith('recording-input-routing-v1:') && record.key !== recordingRoutingSettingKey(originalId)) {
			failures += 1;
			throw new DOMException('The copied routing cannot be stored.', 'QuotaExceededError');
		}
		return put.call(this, record, ...args);
	};
	const uiController = createAudioEditorUiActionController();
	const parity = createAudacityActionRuntime(controller, { uiController, productId: 'soundscaper', locale: 'en', copy: ENGLISH_COPY });
	const fixture = mountControllerDataDom();
	try {
		const menus = productionMenus(controller, fixture, parity);
		const duplicate = findMenuItem<MenuEntry>(menus, 'duplicate-project'); assert.ok(duplicate && !duplicate.disabled);
		assert.equal(duplicate.label, 'Duplicate project');
		const click = duplicate.onClick; assert.ok(typeof click === 'function');
		enabled = true; click();
		await assert.rejects(fixture.settle(), /copied routing cannot be stored/u);
		assert.equal(failures, 1);
		assert.equal(controller.project?.id, originalId);
		assert.deepEqual((await store.listProjects()).map(row => row.id), [originalId]);
		assert.deepEqual(await store.loadProject(originalId), before);
		assert.deepEqual(controller.getSnapshot().history, history);
		enabled = false; click(); await fixture.settle();
		const copyId = controller.project?.id; assert.ok(copyId); assert.notEqual(copyId, originalId);
		assert.equal(controller.project?.title, 'Untitled project copy');
		assert.deepEqual((await store.listProjects()).map(row => row.id).sort(), [originalId, copyId].sort());
		const routing = await store.loadSetting(recordingRoutingSettingKey(copyId));
		assert.ok(routing && typeof routing === 'object');
		assert.deepEqual(await store.loadProject(originalId), before);
	} finally {
		prototype.put = put; database.close();
		// Dispose only the DOM host; do not mask a failed semantic assertion with its already observed request rejection.
		await fixture.run(() => undefined); await fixture.dispose(); parity.dispose(); uiController.dispose();
	}
});
