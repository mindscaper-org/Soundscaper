/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { overlapRippleProject } from './helpers/next-overlap-ripple-project.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const kind of ['takes', 'automation'] as const) test(`NP035: overlapping clip ripple keeps ${kind} aligned with audio`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const { source, project } = overlapRippleProject(kind);
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(source.frameCount).fill(.25)]); await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Overlapping clips.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.timeline.selectClip('first'); controller.actions.timeline.selectClip('second', { additive: true });
	const before = controller.project;
	controller.actions.edit.deletePerTrackRipple();
	const result: unknown = controller.project; assert.ok(validateSoundscaperProject(result));
	assert.equal(result.clips.length, 1, JSON.stringify(controller.getSnapshot().status));
	assert.equal(resolveRuntimeProjectProjection(result).clips[0]?.timelineStartFrame, 72_000);
	if (kind === 'takes') {
		const group = result.takeGroups[0]; assert.ok(group);
		assert.deepEqual([group.startSample, group.endSample], [72_000, 76_800]);
		assert.deepEqual(group.takes.map(take => [take.startSample, take.endSample]), [[72_000, 76_800]]);
		assert.deepEqual(group.compRegions.map(region => [region.startSample, region.endSample]), [[72_000, 76_800]]);
	} else assert.equal(result.automationLanes[0]?.points.find(point => point.id === 'later-gain')?.position, 72_000);
	controller.actions.edit.undo();
	assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...before, revision: 0, updatedAt: '' });
	controller.actions.edit.redo();
	assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...result, revision: 0, updatedAt: '' });
});
