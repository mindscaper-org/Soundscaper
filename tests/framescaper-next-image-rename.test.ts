/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('the public image header rename preserves its image authority and atomic history', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const track = fixture.project.tracks.find(item => Array.isArray(item.clipIds) && item.clipIds.includes(fixture.clip.id)); assert.ok(track);
	const placement = { scope: 'timeline', trackId: track.id };
	const base = applyFramescaperProjectCommand(PROFILE, fixture.project, { type: 'batch', commands: [{
		type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: fixture.clip, expectedPlacement: placement, clip: null, placement: null,
	}, { type: 'image-source/set', sourceId: fixture.source.id, expectedSource: fixture.source, source: null }] });
	assert.ok(await environment.createProjectIfAbsent(base));
	const authored = applyFramescaperProjectCommand(PROFILE, base, { type: 'batch', commands: [{
		type: 'image-source/set', sourceId: fixture.source.id, expectedSource: null, source: fixture.source,
	}, { type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: null, expectedPlacement: null, clip: fixture.clip, placement }] });
	assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes: fixture.bytes }));
	const controller = await createFramescaperFixtureController(environment, fixture.project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready; assert.equal(controller.project?.id, fixture.project.id);
	controller.actions.timeline.selectClip(fixture.clip.id);
	const before = controller.project; assert.ok(before);
	controller.actions.clip.update(fixture.clip.id, { title: 'Renamed image' });
	assert.deepEqual(controller.project?.sources.find(source => source.id === fixture.source.id), { ...fixture.source, name: 'Renamed image' });
	assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.sources, before.sources);
	controller.actions.edit.redo(); assert.equal(controller.project?.sources.find(source => source.id === fixture.source.id)?.name, 'Renamed image');
});
