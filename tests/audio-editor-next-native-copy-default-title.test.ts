/* SPDX-License-Identifier: AGPL-3.0-only */

import { GERMAN_COPY } from './helpers/translation-catalogs.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const locale of ['de', 'en'] as const) test(`NP055: native ${locale} collision Copy persists its localized generated title`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const original = createSoundscaperProject({ id: 'localized-native-copy', title: 'Recording' });
	const archive = await exportScapeProject(original, store); assert.ok(archive.blob instanceof Blob);
	const controller = createAudioEditorController(null, { headless: true, locale, copy: locale === 'de' ? GERMAN_COPY : ENGLISH_COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Recording.sscape'), () => 'copy');
	assert.equal(controller.project?.title, 'Recording');
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Recording.sscape'), () => 'copy');
	const copied = controller.project; assert.ok(copied); assert.notEqual(copied.id, original.id);
	assert.equal(copied.title, locale === 'de' ? 'Recording Kopie' : 'Recording copy');
	assert.equal((await store.loadProject(original.id))?.title, 'Recording');
	assert.equal((await store.loadProject(copied.id))?.title, copied.title);
});
