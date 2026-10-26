/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportDialogHasDeliveredChapterLabels } from '../src/common/editor/ui/export-dialog-embedded-chapters.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { deliverySelectionArchive } from './helpers/more200-delivery-selection-fixture.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

for (const kind of ['clip', 'time', 'outside', 'empty'] as const) test(`chapter embedding follows native ${kind} selection`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.openScapeFile(new File([await deliverySelectionArchive()], 'Selected take.sscape'), () => 'copy');
	await controller.actions.labels.importFile(new File(['1.1\t1.2\tInside selected take\n'], 'Chapter.txt', { type: 'text/plain' }));
	if (kind === 'clip') controller.actions.timeline.selectClip('selected');
	else if (kind === 'time') controller.actions.timeline.setExactSelection(48_000, 72_000, { trackIds: ['voice'] });
	else if (kind === 'outside') controller.actions.timeline.setExactSelection(144_000, 168_000, { trackIds: ['voice'] });
	else controller.actions.timeline.setExactSelection(0, 0, { trackIds: ['voice'] });
	const project = controller.project;
	assert.ok(project);
	const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), format: 'mp3', range: 'selection', embedLabelChapters: true };
	assert.equal(exportDialogHasDeliveredChapterLabels(project, settings), kind === 'clip' || kind === 'time');
	const request = createExportDialogRequest(settings, { project });
	assert.equal(request.embedLabelChapters === true, kind === 'clip' || kind === 'time');
	if (kind === 'clip' || kind === 'time') assert.deepEqual(request.range, { startFrame: 48_000, endFrame: 72_000 });
});
