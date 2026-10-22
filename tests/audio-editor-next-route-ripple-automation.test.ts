/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { routeRippleProject } from './helpers/next-route-ripple-project.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const scope of ['clip', 'range', 'all-tracks'] as const) test(`NP037: ${scope} ripple carries exactly its owned routing automation`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const { project, source } = routeRippleProject();
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(source.frameCount).fill(.25)]); await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Route automation.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	if (scope === 'clip') controller.actions.timeline.selectClip('first');
	else controller.actions.timeline.setExactSelection(0, 48_000, { trackIds: scope === 'range' ? ['voice'] : ['voice', 'other'] });
	const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
	controller.actions.edit.deletePerTrackRipple();
	const result: unknown = controller.project; assert.ok(validateSoundscaperProject(result));
	assert.equal(resolveRuntimeProjectProjection(result).clips.find(clip => clip.id === 'later')?.timelineStartFrame, 144_000);
	assert.equal(result.automationLanes.find(lane => lane.id === 'voice-output')?.points.find(point => point.id === 'voice-later')?.position, 144_000);
	for (const id of ['other-output', 'master-gain']) {
		const lane: (typeof result.automationLanes)[number] | undefined = result.automationLanes.find(lane => lane.id === id); assert.ok(lane);
		if (scope === 'all-tracks') assert.equal(lane.points.at(-1)?.position, 144_000);
		else assert.deepEqual(lane, before.automationLanes.find(lane => lane.id === id), 'unrelated routes and global Master automation stay fixed');
	}
	controller.actions.edit.undo();
	assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...before, revision: 0, updatedAt: '' });
	controller.actions.edit.redo();
	assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...result, revision: 0, updatedAt: '' });
});
