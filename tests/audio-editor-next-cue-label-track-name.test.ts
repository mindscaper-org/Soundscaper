/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const [name, albumTitle, expectedName] of [
	['Album.cue', '   ', 'Album'],
	['   .cue', '', 'Labels'],
	['Album.cue', '  Authored album  ', '  Authored album  '],
] as const) test(`CUE label import derives a usable track name from ${JSON.stringify({ name, albumTitle })}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-cue-name-${crypto.randomUUID()}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const file = new File([`TITLE "${albumTitle}"\nFILE "Recording.wav" WAVE\nTRACK 01 AUDIO\n TITLE "Opening cue"\n INDEX 01 00:01:00\n`], name);
	await controller.actions.labels.importCueFile(file, 'labels');
	const track = controller.project?.tracks.find(track => track.type === 'label');
	assert.equal(track?.name, expectedName);
	assert.match((await controller.actions.labels.export({ download: false })).text, /1\t1\tOpening cue/u);
	controller.actions.edit.undo();
	assert.equal(controller.project?.tracks.some(track => track.type === 'label'), false);
	controller.actions.edit.redo();
	assert.equal(controller.project?.tracks.find(track => track.type === 'label')?.name, expectedName);
});
