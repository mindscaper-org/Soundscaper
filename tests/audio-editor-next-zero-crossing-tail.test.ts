/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { findNearestAudioZeroCrossing } from '../src/common/editor/zero-crossing.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { zeroCrossingRouteProject } from './helpers/next-zero-crossing-route-project.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const selection of ['range', 'clip', 'past-end'] as const) test(`NP039: zero-crossing ${selection} end is searched inside the recording`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const { project, source, samples } = zeroCrossingRouteProject('reference');
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([samples]); await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: () => createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null,
			softwareRenderer: ({ captureStartFrame, endFrame, sampleRate }) => ({ channels: [samples.slice(Number(captureStartFrame), Number(endFrame))], sampleRate }),
		}),
	});
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Tail.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	if (selection === 'clip') controller.actions.timeline.selectClip('recording');
	else controller.actions.timeline.setExactSelection(10_007, selection === 'past-end' ? 48_500 : 48_000, { trackIds: ['voice'] });
	await controller.actions.timeline.zeroCross();
	const expected = findNearestAudioZeroCrossing([samples], samples.length, { maximumDistance: 480 });
	assert.equal(controller.project?.selection.endFrame, selection === 'past-end' ? 48_500 : expected);
});
