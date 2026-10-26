/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudioEditorCueSheet } from '../src/common/editor/cue-import.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

// Independently accepted by libcue2 2.2.1: an apostrophe is legal in a bare token.
for (const field of ['file', 'title', 'performer'] as const) for (const spelling of ["'97", "'"]) {
	test(`CUE import accepts a literal leading apostrophe in a bare ${field}: ${spelling}`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		const values = { file: 'Programme.wav', title: 'Opening', performer: 'Artist', [field]: spelling };
		const cue = `FILE ${values.file} WAVE\nTRACK 01 AUDIO\n TITLE ${values.title}\n PERFORMER ${values.performer}\n INDEX 01 00:00:01\n`;
		const result = await controller.actions.labels.importCueFile(new File([cue], 'Album.cue', { type: 'application/x-cue' }), 'labels');
		assert.ok(result); assert.equal(result.count, 1);
		const labels = controller.project?.tracks.flatMap(track => track.type === 'label' ? track.labels : []) ?? [];
		assert.equal(labels[0]?.title, values.title); assert.equal(labels[0]?.startFrame, 640);
		const parsed = parseAudioEditorCueSheet(cue, { sampleRate: 48_000 });
		assert.equal(parsed.cues[0]?.performer, values.performer);
	});
}

test('CUE quote handling keeps supported paired quotes and malformed double-quote refusals', () => {
	for (const title of ['"Opening"', "'Opening'"]) {
		const parsed = parseAudioEditorCueSheet(`FILE Programme.wav WAVE\nTRACK 01 AUDIO\n TITLE ${title}\n INDEX 01 00:00:00\n`, { sampleRate: 48_000 });
		assert.equal(parsed.cues[0]?.title, 'Opening');
	}
	assert.throws(() => parseAudioEditorCueSheet('TRACK 01 AUDIO\n TITLE "Opening\n INDEX 01 00:00:00\n', { sampleRate: 48_000 }), /malformed/u);
});
