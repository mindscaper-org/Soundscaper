/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { normalizeVideoVisualPresentationV1 } from '../src/common/editor/video-visual-presentation-v27.ts';
import { createFramescaperVisualInspectorCommand, createFramescaperVisualInspectorModel } from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';
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

for (const styled of [false, true]) test(`ordinary Split partitions a32-frame Freeze${styled ? ' with its presentation' : ''} atomically`, async context => {
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
		playheadSample: 0, durationFrames: 32 });
	const leaves: readonly unknown[] = controller.project?.clips ?? [];
	const frozen = normalizeVideoStillClipV1(leaves.find(value => value !== null && typeof value === 'object'
		&& 'kind' in value && value.kind === 'still'));
	controller.actions.timeline.selectClip(frozen.id);
	if (styled) {
		const model = createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: frozen.id });
		controller.actions.edit.commit(createFramescaperVisualInspectorCommand(controller.project, frozen.id, {
			generator: null, opacity: 0.25, blendMode: 'screen', maskId: model.maskId,
			maskWidth: model.maskWidth, presetId: null,
		}) as AudioEditorCommand);
	}
	const before = controller.project; assert.ok(before);
	const history = controller.getSnapshot().history.undoEntries.length;
	controller.actions.edit.splitAt(76_800);
	const after = controller.project; assert.ok(after);
	const result: readonly unknown[] = after.clips;
	const clips = result.filter(value => value !== null && typeof value === 'object'
		&& 'kind' in value && value.kind === 'still').map(normalizeVideoStillClipV1)
		.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
	assert.equal(clips.length, 2); const [left, right] = clips; assert.ok(left && right);
	assert.deepEqual(left, { ...frozen, sequenceFrameCount: 16 });
	assert.deepEqual(right, { ...frozen, id: right.id, sequenceStartFrame: 16, sequenceFrameCount: 16 });
	assert.deepEqual(after.sources, before.sources); assert.deepEqual(after.videoFreezeFallbacks, before.videoFreezeFallbacks);
	assert.deepEqual(after.clips.filter(clip => clip.id !== left.id && clip.id !== right.id),
		before.clips.filter(clip => clip.id !== frozen.id), 'the camera and its linked audio retain their identities and phase');
	assert.ok(Array.isArray(after.videoVisualPresentations));
	const presentations = after.videoVisualPresentations.map(normalizeVideoVisualPresentationV1);
	assert.equal(presentations.length, styled ? 2 : 0);
	if (styled) {
		assert.ok(Array.isArray(before.videoVisualPresentations));
		const original = normalizeVideoVisualPresentationV1(before.videoVisualPresentations[0]);
		for (const clip of clips) {
			const presentation = presentations.find(row => row.owner.kind === 'clip' && row.owner.id === clip.id);
			assert.ok(presentation);
			assert.deepEqual(presentation, { ...original, id: presentation.id, owner: { kind: 'clip', id: clip.id } });
		}
		assert.equal(new Set(presentations.map(row => row.id)).size, 2);
	}
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.videoVisualPresentations, before.videoVisualPresentations);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.videoVisualPresentations, after.videoVisualPresentations);
});
