/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createLegacyAupDirectorySelection } from '../src/common/editor/ui/workspace/legacy-aup-directory-selection.ts';
import { editorProjectEditSessionKey } from '../src/common/editor/ui/project-edit-session-key.ts';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

for (const choice of ['completed', 'cancelled'] as const) test(`a ${choice} legacy directory settles before another selected project can open`, async () => {
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const later = new File(['archive'], 'later.sscape');
	const events: string[] = [];
	const selection = createLegacyAupDirectorySelection({
		getProjectSessionKey: () => 'active-session',
		chooseDirectory: () => { events.push('choose directory'); },
		importFiles: () => { events.push('import legacy project'); },
	});
	const pending = importWorkspaceRoutedFiles({
		controller: { actions: { project: { importFiles() {} }, labels: { importFile() {} } } },
		files: [projectFile, later], importOptions: {}, projectBinVisible: false, requestCueImport() {},
		openProjectFile: file => {
			if (file === projectFile) return selection.choose(file);
			events.push('open following project');
		},
	});
	await new Promise<void>(resolve => setImmediate(resolve));
	const beforeChoice = [...events];
	selection.complete(choice === 'completed' ? [dataFile] : []);
	const count = await pending;
	assert.deepEqual(beforeChoice, ['choose directory']);
	assert.deepEqual(events, choice === 'completed'
		? ['choose directory', 'import legacy project', 'open following project'] : ['choose directory']);
	assert.equal(count, choice === 'completed' ? 2 : 0);
});
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
		const { projectFile, dataFile } = legacyAupFiles('utf-8'); const chosen = selection.choose(projectFile); assert.equal(choices, 1);
		if (mode === 'different-project' || mode === 'same-id-reactivation') {
			await controller.actions.project.create({ title: 'Incoming' });
			if (mode === 'same-id-reactivation') await controller.actions.project.openById(String(originalId));
		} else if (mode === 'current-edit') await controller.actions.project.rename('Edited while choosing');
		const before = controller.project; const inventory = await store.listProjects();
		selection.complete(mode === 'empty-directory' ? [] : [dataFile]);
		const result = await chosen;
		if (mode !== 'current-edit') {
			assert.deepEqual(result, { cancelled: true }); assert.equal(imports, 0); assert.equal(controller.project, before);
			assert.deepEqual(await store.listProjects(), inventory); assert.deepEqual(await store.listSources(), []);
			const ready = selection.choose(projectFile); selection.complete([dataFile]); await ready;
		}
		assert.equal(imports, 1); assert.equal(controller.project?.clips.length, 1);
		const source = controller.project?.sources[0]; assert.ok(source);
		const chunk = await store.readSourceChunk(String(source.storageKey), 0); assert.ok(chunk);
		assert.equal(chunk.frames, 4800); assert.equal(chunk.channels[0]?.[0], .25);
		selection.complete([dataFile]);
		assert.equal(imports, 1, 'a completed choice cannot be replayed');
	});
}
