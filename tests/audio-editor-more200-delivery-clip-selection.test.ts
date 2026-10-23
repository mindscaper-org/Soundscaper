/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createDeliveryBatch } from '../src/common/editor/delivery-batch.ts';
import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import { deliverySelectionArchive } from './helpers/more200-delivery-selection-fixture.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

for (const kind of ['clip', 'time', 'empty'] as const) test(`delivery batch resolves native ${kind} selection`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.openScapeFile(new File([await deliverySelectionArchive()], 'Selected take.sscape'), () => 'copy');
	if (kind === 'clip') controller.actions.timeline.selectClip('selected');
	else if (kind === 'time') controller.actions.timeline.setExactSelection(1000, 2000, { trackIds: ['voice'] });
	else controller.actions.timeline.setExactSelection(0, 0, { trackIds: ['voice'] });
	const project = controller.project;
	assert.ok(project);
	const build = () => createDeliveryBatch(project, {
		batchId: 'selected-take', presets: [validateDeliveryPreset({ schemaVersion: 1, id: 'wav', label: 'WAV', kind: 'audio', format: 'wav', settings: {} })],
		targets: [{ kind: 'selection' }],
	});
	if (kind === 'empty') assert.throws(build, /selection is empty/u);
	else {
		if (kind === 'clip') assert.equal(controller.getSnapshot().selection, null, 'the native selected clip has a collapsed drawn range');
		assert.deepEqual(build().members[0]?.settings.range,
			kind === 'clip' ? { startFrame: 48_000, endFrame: 72_000 } : { startFrame: 1000, endFrame: 2000 });
	}
});
