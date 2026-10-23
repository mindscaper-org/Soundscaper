/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { normalizeVideoStillClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { framescaperSelectedVisualAuthoringRuntimeFor } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { bindFramescaperSelectedFreezeCaptureFinishing } from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';

test('removing a menu-created Freeze through the Bin retires its own fallback atomically', async context => {
	const project = createFramescaperProject(PROFILE, framescaperBaselineOptions());
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = await createFramescaperFixtureController(environment, project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const runtime = framescaperSelectedVisualAuthoringRuntimeFor(controller); assert.ok(runtime);
	context.after(bindFramescaperSelectedFreezeCaptureFinishing(controller, { capture: async () => ({
		blob: new Blob([Uint8Array.of(137, 80, 78, 71)], { type: 'image/png' }), width: 1, height: 1 }) }));
	controller.actions.timeline.selectClip('video-clip');
	const model = createFramescaperSelectedVisualAuthoringModelFinishing({ surface: 'video-freeze',
		project: controller.project, selectedClipId: 'video-clip', playheadSample: 0 });
	await runtime.run('video-freeze', { fence: model.fence, clipId: 'video-clip', operation: 'create',
		playheadSample: 0, durationFrames: 10 });
	const leaves: readonly unknown[] = controller.project?.clips ?? [];
	const frozen = normalizeVideoStillClipV1(leaves.find(value => value !== null && typeof value === 'object'
		&& 'kind' in value && value.kind === 'still'));
	controller.actions.projectBin.moveFromTimeline(frozen.id);
	const before = controller.project; assert.ok(before);
	assert.ok(Array.isArray(before.videoFreezeFallbacks) && before.videoFreezeFallbacks.length === 1);
	controller.actions.projectBin.removeFromProject(frozen.id);
	const after = controller.project; assert.ok(after);
	assert.equal(after.sources.some(source => source.id === frozen.sourceId), false);
	assert.equal(after.projectBin.clips.some(clip => clip.id === frozen.id), false);
	assert.deepEqual(after.videoFreezeFallbacks, []);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.sources, before.sources);
	assert.deepEqual(controller.project?.videoFreezeFallbacks, before.videoFreezeFallbacks);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.sources, after.sources);
	assert.deepEqual(controller.project?.videoFreezeFallbacks, []);
});
