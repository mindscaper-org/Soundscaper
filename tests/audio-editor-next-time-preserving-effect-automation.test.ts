/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { effectAutomationProject } from './helpers/next-time-preserving-effect-project.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const selection of ['range', 'clip'] as const) test(`NP040: same-duration ${selection} effect preserves unbaked native automation`, async context => {
	const { project, source, samples } = effectAutomationProject(); const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([samples]); await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(), engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], engineFactory: () => createAudioEditorEngine({
			audioContextFactory: null, offlineAudioContextFactory: null,
			softwareRenderer: ({ captureStartFrame, endFrame, sampleRate }) => ({ channels: [samples.slice(Number(captureStartFrame), Number(endFrame))], sampleRate }),
		}),
	});
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Automation.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	if (selection === 'clip') controller.actions.timeline.selectClip('clip');
	else controller.actions.timeline.setExactSelection(0, samples.length, { trackIds: ['voice'] });
	const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
	await controller.actions.effects.applySelection({ type: 'audacity-invert', params: {} });
	const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
	assert.notDeepEqual(after.clips, before.clips, 'Invert publishes its actual processed audio');
	assert.deepEqual(after.automationLanes, before.automationLanes);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.automationLanes, before.automationLanes);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.automationLanes, after.automationLanes);
});
