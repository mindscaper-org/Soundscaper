/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { normalizeVideoStillClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { prepareTimelineStillTrim } from '../src/common/editor/timeline-generator-trim.ts';
import { resolveTimelineTrimPointerPreview } from '../src/common/editor/ui/timeline/trim-pointer-routing.ts';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const edge of ['left', 'right'] as const) {
	test(`a frozen ${edge} edge previews on its native sequence clock`, () => {
		const project = frozenProject();
		const runtime = createEditorProjectRuntimeSelection(PROFILE).projectForCommandConsumers(project);
		const displayed = runtime.clips.find(clip => clip.id === 'frozen'); assert.ok(displayed);
		const preview: unknown = resolveTimelineTrimPointerPreview({ project: runtime, projectIndex: null,
			session: { clipId: 'frozen', clipIds: ['frozen'], original: displayed }, edge,
			requestedBoundarySample: edge === 'left' ? 72_000 : 96_000,
			legacyRequestedDelta: () => assert.fail('A frozen PNG has no audio source EOF'),
			previewVideo: () => assert.fail('A frozen PNG has no camera source frame window'),
			createLegacyPreview: () => assert.fail('A frozen PNG requires its native timeline'),
		});
		assert.ok(preview && typeof preview === 'object' && 'sequenceStartFrame' in preview && 'sequenceFrameCount' in preview);
		assert.equal(preview.sequenceStartFrame, edge === 'left' ? 45 : 30);
		assert.equal(preview.sequenceFrameCount, edge === 'left' ? 75 : 30);
	});

	test(`a frozen ${edge} trim publishes exactly once and retains Undo/Redo`, async context => {
		const project = frozenProject();
		const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
		assert.ok(await environment.createProjectIfAbsent(project));
		const controller = await createFramescaperFixtureController(environment, project.id);
		context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
		const history = controller.getSnapshot().history.undoEntries.length;
		controller.actions.clip.trim('frozen', edge === 'left' ? { timelineStartFrame: 72_000 } : { durationFrames: 48_000 });
		const after = controller.project; assert.ok(after);
		const leaves: readonly unknown[] = after.clips;
		const clip = normalizeVideoStillClipV1(leaves.find(value => value !== null && typeof value === 'object' && 'id' in value && value.id === 'frozen'));
		assert.equal(clip.sequenceStartFrame, edge === 'left' ? 45 : 30);
		assert.equal(clip.sequenceFrameCount, edge === 'left' ? 75 : 30);
		assert.deepEqual(after.sources, project.sources);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, project.clips);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
	});
}

test('frozen picture timing keeps a whole frame minimum and can extend its constant PNG', () => {
	const original = normalizeVideoStillClipV1({ schemaVersion: 1, kind: 'still', id: 'frozen', sourceId: 'png',
		sequenceId: 'main', sequenceStartFrame: 30, sequenceFrameCount: 90 });
	const clock = { sampleRate: 44_100, sequences: [{ id: 'main', rate: { num: 30_000, den: 1_001 } }] };
	assert.equal(prepareTimelineStillTrim(clock, original, { durationFrames: 1 }).sequenceFrameCount, 1);
	assert.equal(prepareTimelineStillTrim(clock, original, { durationFrames: 441_441 }).sequenceFrameCount, 300);
	const head = prepareTimelineStillTrim(clock, original, { timelineStartFrame: 66_216 });
	assert.equal(head.sequenceStartFrame, 45);
	assert.equal(head.sequenceFrameCount, 75);
	assert.deepEqual(prepareTimelineStillTrim(clock, head, { timelineStartFrame: 44_144 }), original);
});

function frozenProject() {
	return createFramescaperProject(PROFILE, { id: 'frozen-picture', primarySequenceId: 'main',
		visualModel: { stillSources: [{ schemaVersion: 1, kind: 'still', id: 'png', name: 'Camera Freeze', mimeType: 'image/png',
			storageKey: 'png', contentSha256: 'ab'.repeat(32), width: 16, height: 16, hasAlpha: false }] },
		clips: [{ schemaVersion: 1, kind: 'still', id: 'frozen', sourceId: 'png', sequenceId: 'main', sequenceStartFrame: 30, sequenceFrameCount: 90 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['frozen'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }],
	});
}
