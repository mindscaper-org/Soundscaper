/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

for (const action of ['selectTrackStartToEnd', 'selectTrackStartToCursor', 'selectCursorToTrackEnd'] as const) test(`NP014: ${action} resolves the selected musical label track at its authored tempo`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'musical-labels', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ id: 'head', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'change', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } }] },
		tracks: [{ id: 'labels', type: 'label', labels: [{ id: 'span', title: 'Across tempo change', anchor: 'musical',
			startBeat: { num: 3, den: 1 }, endBeat: { num: 5, den: 1 } }] }],
		sequences: [{ id: 'main', trackIds: ['labels'] }], primarySequenceId: 'main' }));
	controller.actions.timeline.selectTrack('labels'); engine.seek(96_000);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	const labelsBefore = structuredClone(controller.project?.tracks[0]?.labels);
	controller.actions.timeline[action]();
	const expected = action === 'selectTrackStartToEnd' ? [72_000, 144_000]
		: action === 'selectTrackStartToCursor' ? [72_000, 96_000] : [96_000, 144_000];
	assert.deepEqual([controller.project?.selection.startFrame, controller.project?.selection.endFrame], expected);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount, 'selecting content must not create an undo entry');
	assert.deepEqual(controller.project?.tracks[0]?.labels, labelsBefore);
});
