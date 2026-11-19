/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { rewriteScapeProjectDocument } from './helpers/scape-archive-rewrite.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createAudioEditorController, createMemoryEngine, createProjectStore, COPY } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

async function setup(context: TestContext) {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const saved: Blob[] = [];
	const fileService = { isDesktop: false, chooseSaveTarget: async () => ({ browserDownload: true }),
		prepareSave: async () => ({ mode: 'blob', target: { browserDownload: true } }),
		saveFile: async ({ blob }: { blob: Blob }) => { saved.push(blob); return { fileName: 'copy.sscape', size: blob.size }; } };
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		fileService: fileService as unknown as Options['fileService'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const archive = async (id: string, future: boolean, title = id) => {
		const result = await exportScapeProject(createSoundscaperProject({ id, title }), store); assert.ok(result.blob instanceof Blob);
		return future ? rewriteScapeProjectDocument(result.blob, (document: { schemaVersion: number; futureOpaqueValue?: string }) => { document.schemaVersion = 2; document.futureOpaqueValue = 'Keep exact bytes'; }) : result.blob;
	};
	return { controller, store, archive, saved };
}

for (const secondFuture of [false, true]) test(`NP029: a retained future archive survives another ${secondFuture ? 'future' : 'current'} project file`, async context => {
	const { controller, archive, saved } = await setup(context);
	const first = await archive('first-opaque', true), second = await archive('second-project', secondFuture);
	await controller.actions.project.openScapeFile(new File([first], 'future.sscape'), () => 'open-read-only');
	const firstTab = controller.project!.id;
	assert.equal(controller.getSnapshot().readOnly, true);
	await controller.actions.project.create({ title: 'Ordinary' });
	await controller.actions.project.openScapeFile(new File([second], 'second.sscape'), () => secondFuture ? 'open-read-only' : 'copy');
	const secondTab = controller.project!.id;
	await controller.actions.project.openById(firstTab);
	await controller.actions.project.saveScape({ saveCopy: true, useFileSystemAccess: false });
	assert.ok(saved[0]); assert.deepEqual(new Uint8Array(await saved[0].arrayBuffer()), new Uint8Array(await first.arrayBuffer()));
	if (secondFuture) {
		await controller.actions.project.openById(secondTab);
		await controller.actions.project.saveScape({ saveCopy: true, useFileSystemAccess: false });
		assert.ok(saved[1]); assert.deepEqual(new Uint8Array(await saved[1].arrayBuffer()), new Uint8Array(await second.arrayBuffer()));
	}
});

test('two different future files sharing a project ID keep their own tabs and exact Save Copy bytes', async context => {
	const { controller, archive, saved } = await setup(context);
	const first = await archive('shared-original-id', true, 'Earlier future edit');
	const second = await archive('shared-original-id', true, 'Later future edit');
	await controller.actions.project.openScapeFile(new File([first], 'Earlier.sscape'), () => 'open-read-only');
	const firstId = controller.project!.id;
	await controller.actions.project.openScapeFile(new File([second], 'Later.sscape'), () => 'open-read-only');
	assert.notEqual(controller.project!.id, firstId);
	assert.equal(controller.project?.title, 'Later future edit');
	await controller.actions.project.saveScape({ saveCopy: true, useFileSystemAccess: false });
	await controller.actions.project.openById(firstId);
	assert.equal(controller.project?.title, 'Earlier future edit');
	await controller.actions.project.saveScape({ saveCopy: true, useFileSystemAccess: false });
	assert.deepEqual(await saved[0]?.arrayBuffer(), await second.arrayBuffer());
	assert.deepEqual(await saved[1]?.arrayBuffer(), await first.arrayBuffer());
	const editable = await archive('shared-original-id', false, 'Editable version');
	await controller.actions.project.openScapeFile(new File([editable], 'Editable.sscape'), () => 'copy');
	assert.equal(controller.project?.title, 'Editable version');
	assert.equal(controller.getSnapshot().readOnly, false);
});

test('viewing a temporary opaque archive preserves the last saved project for startup', async context => {
	const { controller, store, archive } = await setup(context);
	const editable = controller.project!.id;
	const first = await archive('temporary-future', true);
	await controller.actions.project.openScapeFile(new File([first], 'Future.sscape'), () => 'open-read-only');
	assert.equal(await store.loadSetting('soundscaper:last-project-id'), editable);
	const recent = await store.loadSetting('soundscaper:audio-editor-recent-project-ids');
	assert.deepEqual(recent, [editable]);
	await controller.actions.project.openById(editable);
	const opaque = controller.getSnapshot().projectTabs.find(tab => tab.title === 'temporary-future');
	assert.ok(opaque);
	await controller.actions.project.openById(opaque.id);
	assert.equal(await store.loadSetting('soundscaper:last-project-id'), editable);
});

test('opening a newer version immediately reports why its project tab is read-only', async context => {
	const { controller, archive } = await setup(context);
	const future = await archive('future-status', true);
	await controller.actions.project.openScapeFile(new File([future], 'Newer.sscape'), () => 'open-read-only');
	assert.match(controller.getSnapshot().status.message, /newer version/iu);
});
