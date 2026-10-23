/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const rate of [25, 30]) for (const occupied of [false, true]) test(`a Bin visual honors its explicit ${rate}fps secondary target (${occupied ? 'occupied' : 'clear'})`, async context => {
	const project = createFramescaperProject(PROFILE, { id: `explicit-visual-${rate}`,
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'solid-source', name: 'Solid',
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150,
			generator: { kind: 'solid', color: '#ffffffff' } }] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'solid', sourceId: 'solid-source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 },
			...(occupied ? [{ schemaVersion: 1, kind: 'generator', id: 'existing', sourceId: 'solid-source', sequenceId: 'cut',
				sequenceStartFrame: 0, sequenceFrameCount: rate * 5, sourceInFrame: 0, sourceFrameCount: 150 }] : [])],
		tracks: [{ id: 'main-pictures', type: 'video', clipIds: ['solid'] }, { id: 'cut-pictures', type: 'video', clipIds: occupied ? ['existing'] : [] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['main-pictures'] },
			{ id: 'cut', rate: { num: rate, den: 1 }, trackIds: ['cut-pictures'] }], primarySequenceId: 'main' });
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = await createFramescaperFixtureController(environment, project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	controller.actions.projectBin.moveFromTimeline('solid');
	const before = controller.project; assert.ok(before);
	const id = controller.actions.projectBin.place('solid', { trackId: 'cut-pictures', timelineStartFrame: 48_000 });
	const placed = controller.project?.clips.find(clip => clip.id === id); assert.ok(placed);
	assert.equal(placed.sequenceId, 'cut');
	assert.equal(placed.sequenceStartFrame, rate); assert.equal(placed.sequenceFrameCount, rate * 5);
	const targetTrack = controller.project?.tracks.find(track => track.clipIds.includes(String(id))); assert.ok(targetTrack);
	assert.ok(controller.project?.sequences.find(sequence => sequence.id === 'cut')?.trackIds.includes(targetTrack.id));
	assert.deepEqual(controller.project?.tracks.find(track => track.id === 'cut-pictures')?.clipIds, occupied ? ['existing'] : [id]);
	assert.deepEqual(controller.project?.tracks.find(track => track.id === 'main-pictures')?.clipIds, []);
	assert.deepEqual(controller.project?.projectBin.clips, before.projectBin.clips);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips.find(clip => clip.id === id), placed);
});
