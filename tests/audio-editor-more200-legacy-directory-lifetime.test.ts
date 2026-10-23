/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createLegacyAupDirectorySelection } from '../src/common/editor/ui/workspace/legacy-aup-directory-selection.ts';
import { editorProjectEditSessionKey } from '../src/common/editor/ui/project-edit-session-key.ts';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const mode of ['current-edit', 'different-project', 'same-id-reactivation', 'empty-directory'] as const) {
	test(`a legacy directory continuation owns its project activation: ${mode}`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		const originalId = controller.project?.id; assert.equal(typeof originalId, 'string');
		let choices = 0; let imports = 0;
		const selection = createLegacyAupDirectorySelection({
			getProjectSessionKey: () => editorProjectEditSessionKey(controller, controller.project?.id),
			chooseDirectory: () => { choices++; },
			importFiles: files => { imports++; return controller.actions.project.importFiles(files); },
		});
		const { projectFile, dataFile } = legacyAupFiles('utf-8'); selection.choose(projectFile); assert.equal(choices, 1);
		if (mode === 'different-project' || mode === 'same-id-reactivation') {
			await controller.actions.project.create({ title: 'Incoming' });
			if (mode === 'same-id-reactivation') await controller.actions.project.openById(String(originalId));
		} else if (mode === 'current-edit') await controller.actions.project.rename('Edited while choosing');
		const before = controller.project; const inventory = await store.listProjects();
		const result = await selection.complete(mode === 'empty-directory' ? [] : [dataFile]);
		if (mode !== 'current-edit') {
			assert.equal(result, 0); assert.equal(imports, 0); assert.equal(controller.project, before);
			assert.deepEqual(await store.listProjects(), inventory); assert.deepEqual(await store.listSources(), []);
			selection.choose(projectFile); await selection.complete([dataFile]);
		}
		assert.equal(imports, 1); assert.equal(controller.project?.clips.length, 1);
		const source = controller.project?.sources[0]; assert.ok(source);
		const chunk = await store.readSourceChunk(String(source.storageKey), 0); assert.ok(chunk);
		assert.equal(chunk.frames, 4800); assert.equal(chunk.channels[0]?.[0], .25);
		assert.equal(await selection.complete([dataFile]), 0, 'a completed choice cannot be replayed');
	});
}
