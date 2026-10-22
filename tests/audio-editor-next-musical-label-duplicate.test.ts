/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

for (const anchor of ['musical', 'sample'] as const) test(`NP018: Edit Duplicate clips ${anchor} label authority to the selected range`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const label = { id: 'span', title: 'Across tempo change', anchor, ...(anchor === 'musical'
		? { startBeat: { num: 3, den: 1 }, endBeat: { num: 5, den: 1 } }
		: { startFrame: 72_000, endFrame: 144_000 }) };
	await controller.actions.project.open(createSoundscaperProject({ id: 'duplicate-labels', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ id: 'head', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'change', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } }] },
		tracks: [{ id: 'labels', type: 'label', labels: [label] }],
		sequences: [{ id: 'main', trackIds: ['labels'] }], primarySequenceId: 'main' }));
	controller.actions.timeline.setExactSelection(84_000, 120_000, { trackIds: ['labels'] });
	const before = structuredClone(controller.project?.tracks);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.edit.duplicate();
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.tracks.length, 2);
	const labels = project.tracks[1]?.labels; assert.ok(Array.isArray(labels));
	const copied: unknown = labels[0]; assert.ok(record(copied));
	assert.notEqual(copied.id, 'span');
	assert.equal(copied.anchor, anchor);
	if (anchor === 'musical') assert.deepEqual([copied.startBeat, copied.endBeat], [{ num: 7, den: 2 }, { num: 9, den: 2 }]);
	else assert.deepEqual([copied.startFrame, copied.endFrame], [84_000, 120_000]);
	assert.deepEqual(controller.project?.tracks[0], before?.[0]);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	const duplicated = structuredClone(controller.project?.tracks);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.tracks, before);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks, duplicated);
});

function record(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
