/* SPDX-License-Identifier: AGPL-3.0-only */

import { GERMAN_COPY } from './helpers/translation-catalogs.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

for (const locale of ['de', 'en'] as const) test(`NP023: ${locale} folder menu actions persist localized default names and preserve custom names`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale, copy: locale === 'de' ? GERMAN_COPY : ENGLISH_COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'voice', tracks: [createAudioTrack({ id: 'voice-track', name: 'Voice' })] }));
	const first = controller.actions.trackFolders.wrapSelection(['voice-track']);
	const name = (id: unknown) => {
		const current: unknown = controller.project; assert.ok(validateSoundscaperProject(current));
		return current.trackFolders.find(folder => folder.id === id)?.name;
	};
	assert.equal(name(first), locale === 'de' ? 'Ordner 1' : 'Folder 1');
	const second = controller.actions.trackFolders.create();
	assert.equal(name(second), locale === 'de' ? 'Ordner 2' : 'Folder 2');
	const custom = controller.actions.trackFolders.create('My own folder'); assert.equal(name(custom), 'My own folder');
	await controller.actions.project.save();
	const before = controller.project?.trackFolders; controller.actions.edit.undo(); controller.actions.edit.redo();
	assert.deepEqual(controller.project?.trackFolders, before);
});
