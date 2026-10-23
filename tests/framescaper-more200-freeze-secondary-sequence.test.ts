/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperSelectedVisualAuthoringRuntimeFor } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { bindFramescaperSelectedFreezeCaptureFinishing } from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';

for (const sequenceId of ['main-sequence', 'cut']) test(`Freeze keeps the selected ${sequenceId} camera owner`, async context => {
	const options = framescaperBaselineOptions(); assert.ok(Array.isArray(options.clips));
	const clips: unknown[] = options.clips;
	const project = createFramescaperProject(PROFILE, { ...options, clips: clips.map(value => {
		assert.ok(value && typeof value === 'object' && 'kind' in value);
		return value.kind === 'video' ? { ...value, sequenceId } : value;
	}), tracks: [{ id: 'primary-pictures', type: 'video', clipIds: [] },
		...(sequenceId === 'main-sequence' ? [{ id: 'video-track', type: 'video', clipIds: ['video-clip'] }] : []),
		{ id: 'audio-track', type: 'audio', clipIds: ['audio-clip'] },
		...(sequenceId === 'cut' ? [{ id: 'video-track', type: 'video', clipIds: ['video-clip'] }] : [])],
	sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 },
		trackIds: sequenceId === 'main-sequence' ? ['primary-pictures', 'video-track', 'audio-track'] : ['primary-pictures', 'audio-track'] },
		{ id: 'cut', rate: { num: 10, den: 1 }, trackIds: sequenceId === 'cut' ? ['video-track'] : [] }] });
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = await createFramescaperFixtureController(environment, project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const runtime = framescaperSelectedVisualAuthoringRuntimeFor(controller); assert.ok(runtime);
	const release = bindFramescaperSelectedFreezeCaptureFinishing(controller, { capture: async () => ({
		blob: new Blob([Uint8Array.of(137, 80, 78, 71)], { type: 'image/png' }), width: 1, height: 1 }) });
	context.after(release);
	controller.actions.timeline.selectClip('video-clip'); controller.actions.transport.seek(7_200);
	const before = controller.project; assert.ok(before);
	const model = createFramescaperSelectedVisualAuthoringModelFinishing({ surface: 'video-freeze',
		project: before, selectedClipId: 'video-clip', playheadSample: 7_200 });
	await runtime.run('video-freeze', { fence: model.fence, clipId: 'video-clip', operation: 'create',
		playheadSample: 7_200, durationFrames: 5 });
	const after = controller.project; assert.ok(after);
	const still = after.clips.find(clip => clip.kind === 'still'); assert.ok(still);
	assert.equal(still.sequenceId, sequenceId);
	const track = after.tracks.find(track => track.clipIds.includes(still.id)); assert.ok(track);
	assert.ok(after.sequences.find(sequence => sequence.id === sequenceId)?.trackIds.includes(track.id));
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
});
