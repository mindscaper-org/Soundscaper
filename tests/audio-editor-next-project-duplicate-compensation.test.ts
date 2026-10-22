/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { recordingRoutingSettingKey } from '../src/common/editor/recording-routing.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createProjectAdminService } from '../src/common/editor/controller/document/project-admin-service.ts';
import { createFixture as createAdminFixture } from './audio-editor-project-admin-service-fixture.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const changedCopy of [false, true]) test(`NP058: failed Duplicate routing ${changedCopy ? 'preserves an independently changed copy' : 'leaves no orphan project'}`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
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
