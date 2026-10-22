/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

for (const rate of [25, 30, 60]) test(`placing a ${rate}fps secondary title from Bin into30fps preserves five seconds`, async context => {
	const project = createFramescaperProject(PROFILE, { id: `visual-bin-${rate}`, visualModel: { generatorSources: [{
		schemaVersion: 1, kind: 'generator', id: 'title-source', name: 'Title', width: 1920, height: 1080,
		frameRate: { num: rate, den: 1 }, frameCount: rate * 5, generator: { kind: 'solid', color: '#ffffffff' },
	}] }, clips: [{ schemaVersion: 1, kind: 'generator', id: 'title', sourceId: 'title-source', sequenceId: 'cut',
		sequenceStartFrame: 0, sequenceFrameCount: rate * 5, sourceInFrame: 0, sourceFrameCount: rate * 5 }],
	tracks: [{ id: 'pictures', type: 'video', clipIds: ['title'] }],
	sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] },
		{ id: 'cut', rate: { num: rate, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = await createFramescaperFixtureController(environment, project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	assert.deepEqual(controller.actions.projectBin.moveFromTimeline('title'), ['title']);
	const current = controller.project; assert.ok(current);
	const clip = current.projectBin.clips[0]; assert.ok(clip);
	assert.equal(clip.sequenceId, 'cut');
	const placedId = controller.actions.projectBin.place('title');
	const placed = controller.project?.clips.find(value => value.id === placedId); assert.ok(placed);
	assert.equal(placed.sequenceId, 'main'); assert.equal(placed.sequenceFrameCount, 150);
	assert.equal(placed.sourceFrameCount, rate * 5);
	assert.deepEqual(controller.project?.projectBin.clips, current.projectBin.clips);
	controller.actions.edit.undo(); assert.equal(controller.project?.clips.length, 0);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips.find(value => value.id === placedId), placed);
});
