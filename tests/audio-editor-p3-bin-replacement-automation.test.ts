/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { routeRippleProject } from './helpers/next-route-ripple-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const mode of ['contract-gaps', 'keep-spacing'] as const) test(`P3-001: shorter Bin replacement preserves automation (${mode})`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const { project: base, source } = routeRippleProject();
	const first = base.clips.find(clip => clip.id === 'first'); assert.ok(first);
	const project = createSoundscaperProject({ ...base, projectBin: { clips: [{ ...first, id: 'bin', binItemId: 'bin' }] } });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(source.frameCount).fill(.25)]); await writer.commit();
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Replace.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const opened: unknown = controller.project; assert.ok(validateSoundscaperProject(opened));
	const samples = new Float32Array(24_000).fill(.5);
	const bytes = Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, bitDepth: 16, dither: false }));
	const replacement = await controller.actions.projectBin.prepareReplacement('bin', new File([bytes], 'Short.wav', { type: 'audio/wav' }));
	assert.ok(replacement); assert.equal(replacement.requiresChoice, true);
	controller.actions.projectBin.applyReplacement(replacement.token, mode);
	const result: unknown = controller.project; assert.ok(validateSoundscaperProject(result));
	const expectedFrame = mode === 'contract-gaps' ? 168_000 : 192_000;
	assert.equal(result.clips.find(clip => clip.id === 'later')?.timelineStartFrame, expectedFrame);
	assert.equal(result.automationLanes.find(lane => lane.id === 'voice-output')?.points.find(point => point.id === 'voice-later')?.position, expectedFrame);
	const before = project.automationLanes.find(lane => lane.id === 'master-gain');
	assert.deepEqual(result.automationLanes.find(lane => lane.id === 'master-gain'), before, 'per-track gap closure leaves programme automation fixed');
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, opened.clips);
	assert.deepEqual(controller.project?.automationLanes, opened.automationLanes);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, result.clips);
	assert.deepEqual(controller.project?.automationLanes, result.automationLanes);
});
