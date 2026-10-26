/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';

for (const rate of [25, 60]) for (const selected of [true, false]) test(`${selected ? 'Selected' : 'Default'} track owns direct title generation beside ${rate}fps media`, async context => {
	const clip = { schemaVersion: 1, kind: 'generator', id: 'placed', sourceId: 'source', sequenceId: 'cut',
		sequenceStartFrame: 0, sequenceFrameCount: rate * 6, sourceInFrame: 0, sourceFrameCount: rate * 6 };
	const project = createFramescaperProject(PROFILE, { id: 'secondary-generator',
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Existing',
			width: 1920, height: 1080, frameRate: { num: rate, den: 1 }, frameCount: rate * 6,
			generator: { kind: 'solid', color: '#ffffffff' } }] }, clips: [clip],
		tracks: [{ id: 'cut-pictures', type: 'video', clipIds: ['placed'] }, { id: 'main-pictures', type: 'video', clipIds: [] }],
		sequences: [{ id: 'cut', rate: { num: rate, den: 1 }, trackIds: ['cut-pictures'] },
			{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['main-pictures'] }], primarySequenceId: 'main' });
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = await createFramescaperFixtureController(environment, project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	if (selected) controller.actions.timeline.selectClip('placed');
	const before = controller.project; assert.ok(before);
	const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(runtime);
	await runtime.run('video-title');
	const added = normalizeVideoGeneratorClipV1(controller.project?.clips.find(value => value.id !== 'placed'));
	assert.equal(added.sequenceId, selected ? 'cut' : 'main');
	assert.equal(added.sequenceStartFrame, selected ? rate * 6 : 0);
	assert.equal(added.sequenceFrameCount, selected ? rate * 5 : 150);
	assert.deepEqual(controller.project?.tracks.find(track => track.id === (selected ? 'main-pictures' : 'cut-pictures'))?.clipIds, selected ? [] : ['placed']);
	assert.deepEqual(controller.project?.sequences, before.sequences, 'authoring never reassigns existing track hierarchy');
	assert.deepEqual(controller.project?.clips.find(value => value.id === 'placed'), before.clips[0]);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.equal(controller.project?.clips.find(value => value.id === added.id)?.sequenceId, selected ? 'cut' : 'main');
});
