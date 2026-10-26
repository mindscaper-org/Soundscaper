/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { routeRippleProject } from './helpers/next-route-ripple-project.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const [allTracks, silent] of [[true, false], [false, false], [true, true]] as const) test(`NP042: duration change preserves global ownership allTracks=${allTracks},silent=${silent}`, async context => {
	const { project: base, source } = routeRippleProject(); const samples = new Float32Array(source.frameCount).fill(.25);
	const project = silent ? createSoundscaperProject({ ...base, clips: base.clips.map(clip => clip.id === 'other-clip'
		? { ...clip, timelineStartFrame: 192_000 } : clip) }) : base;
	const runtime = createSoundscaperProjectRuntimeSelection();
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
	controller.actions.timeline.setExactSelection(0, samples.length, { trackIds: allTracks ? ['voice', 'other'] : ['voice'] });
	const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
	await controller.actions.effects.applySelection({ type: 'audacity-repeat', params: { count: 1 } });
	const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
	assert.equal(after.automationLanes.find(lane => lane.id === 'voice-output')?.points.at(-1)?.position, 240_000);
	assert.equal(after.automationLanes.find(lane => lane.id === 'master-gain')?.points.at(-1)?.position, allTracks ? 240_000 : 192_000);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.automationLanes, before.automationLanes);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.automationLanes, after.automationLanes);
});
