/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { decodeAuBlockFile } from '../src/common/editor/aup-legacy.js';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const folder of [false, true]) for (const standaloneFirst of [false, true]) test(`P3-022: mixed legacy AUP retains independent AU; first=${String(standaloneFirst)}, folder=${String(folder)}`, async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const codec = { ...createMemoryFfmpeg(), decode: async (file: File) => ({
		channels: [decodeAuBlockFile(new Uint8Array(await file.arrayBuffer()))], sampleRate: 48_000,
	}) };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: codec as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const bytes = new Uint8Array(await dataFile.arrayBuffer()); const view = new DataView(bytes.buffer);
	for (let index = 0; index < 4800; index++) view.setFloat32(24 + index * 4, -.5);
	const independent = new File([bytes], 'Independent.au', { type: 'audio/basic' });
	const orphan = new File([bytes], 'e0001.au');
	if (folder) {
		Object.defineProperty(dataFile, 'webkitRelativePath', { value: 'Selected/Été_data/e00/d00/e0000.au' });
		Object.defineProperty(orphan, 'webkitRelativePath', { value: 'Selected/Été_data/e00/d00/e0001.au' });
		Object.defineProperty(independent, 'webkitRelativePath', { value: 'Selected/Independent.au' });
	}
	const batch = standaloneFirst ? [independent, projectFile, dataFile] : [projectFile, dataFile, independent];
	await controller.actions.project.importFiles(folder ? [...batch, orphan] : batch);
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.clips.length, 2, 'only the AU block consumed by the legacy project is skipped as standalone media');
	assert.equal(project.sources.length, 2);
	const clip = project.clips.find(item => item.title === independent.name || item.title === 'Independent'); assert.ok(clip);
	const source = project.sources.find(item => item.id === clip.sourceId); assert.ok(source);
	const chunk = await store.readSourceChunk(source.storageKey, 0); assert.ok(chunk);
	assert.equal(chunk.channels[0]?.[0], -.5);
	assert.equal(chunk.channels[0]?.[4799], -.5);
});
