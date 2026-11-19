/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

async function openImageProject() {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const { project, clip, source, bytes } = createFramescaperBaselineImageFixture({ imageOnly: true });
	const trackId = 'video-track';
	const placement = { scope: 'timeline', trackId };
	const base = applyFramescaperProjectCommand(PROFILE, project, { type: 'batch', commands: [{
		type: 'image-clip/set', clipId: clip.id, expectedClip: clip, expectedPlacement: placement, clip: null, placement: null,
	}, { type: 'image-source/set', sourceId: source.id, expectedSource: source, source: null }] });
	assert.ok(await environment.createProjectIfAbsent(base));
	const authored = applyFramescaperProjectCommand(PROFILE, base, { type: 'batch', commands: [{
		type: 'image-source/set', sourceId: source.id, expectedSource: null, source,
	}, { type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip, placement }] });
	assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes }));
	const controller = await createFramescaperFixtureController(environment, project.id);
	await controller.ready;
	return { controller, clip, trackId, async dispose() { await controller.dispose(); await environment.close(); } };
}

test('Edit > Delete and leave gap removes the selected interval inside an animated image', async () => {
	const fixture = await openImageProject();
	const { controller, clip, trackId } = fixture;
	try {
		controller.actions.timeline.setSelection(48_000, 96_000, { trackIds: [trackId] });
		controller.actions.edit.deleteLeaveGap();
		const survivors = controller.project?.clips.filter(item => item.kind === 'image') ?? [];
		assert.deepEqual(survivors.map(item => [item.sequenceStartFrame, item.sequenceFrameCount, item.sourceStartTicks]),
			[[0, 10, '0'], [20, 130, '2000000']]);
		controller.actions.edit.undo();
		assert.deepEqual(controller.project?.clips.find(item => item.id === clip.id), clip);
	} finally { await fixture.dispose(); }
});

test('Edit > Trim Outside Selection keeps just the selected animated image interval', async () => {
	const fixture = await openImageProject();
	const { controller, clip, trackId } = fixture;
	try {
		controller.actions.timeline.setSelection(48_000, 96_000, { trackIds: [trackId] });
		controller.actions.edit.trimOutsideSelection();
		assert.deepEqual(controller.project?.clips.find(item => item.id === clip.id), {
			...clip, sequenceStartFrame: 10, sequenceFrameCount: 10, sourceStartTicks: '1000000',
		});
	} finally { await fixture.dispose(); }
});
