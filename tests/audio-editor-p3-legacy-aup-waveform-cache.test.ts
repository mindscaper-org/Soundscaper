/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const failure of ['none', 'cache', 'pcm'] as const) test(`legacy AUP import preserves authoritative PCM with ${failure} failure`, async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const previous = controller.project;
	let faults = 0;
	const save = store.saveAnalysis.bind(store);
	store.saveAnalysis = async (key: string, value: unknown) => {
		if (failure === 'cache' && key.startsWith('audio-editor-peaks-v2:')) {
			faults++; throw new DOMException('Waveform cache full', 'QuotaExceededError');
		}
		return save(key, value);
	};
	const begin = store.beginSourceWrite.bind(store);
	store.beginSourceWrite = async (...args: Parameters<typeof begin>) => {
		const writer = await begin(...args);
		if (failure === 'pcm') writer.write = async () => { faults++; throw new Error('Required PCM write failed'); };
		return writer;
	};
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	await controller.actions.project.importFiles([projectFile, dataFile]);
	assert.equal(faults > 0, failure !== 'none');
	if (failure === 'pcm') {
		assert.equal(controller.project, previous, 'required PCM failure must not activate a partial import');
		assert.deepEqual(await store.listSources(), [], 'failed PCM publication is rolled back');
		return;
	}
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.notEqual(project.id, previous?.id, 'the healthy decoded project must activate despite an optional cache failure');
	assert.equal(project.clips.length, 1);
	assert.equal(project.timelineAnnotations[0]?.name, 'Repère 日本語 🎵');
	const source = project.sources[0]; assert.ok(source);
	assert.equal(source.frameCount, 4800);
	const chunk = await store.readSourceChunk(source.storageKey, 0); assert.ok(chunk);
	assert.equal(chunk.channels[0]?.[0], .25); assert.equal(chunk.channels[0]?.[4799], -.25);
	const saved: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(saved));
	assert.equal(saved.sources[0]?.id, source.id, 'the activated project retains durable source custody');
});
