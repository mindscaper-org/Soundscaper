/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { videoPreviewBenchmarkMedia } from './browser/fixtures/video-preview-benchmark-media.js';

for (const explicit of [false, true]) test(`${explicit ? 'explicit' : 'selected'} secondary video Target owns the native Project Bin edit`, async context => {
	const file = videoPreviewBenchmarkMedia.file, sourceId = `camera-${randomUUID()}`;
	const source = createVideoSource({ id: sourceId, storageKey: sourceId, name: 'Camera', mimeType: 'video/webm',
		contentSha256: createHash('sha256').update(file.buffer).digest('hex'), frameRate: { num: 30, den: 1 },
		sourceFrameCount: 180, sampleRate: 48_000, sampleFrameCount: 288_000, width: 1280, height: 720 });
	const clip = { kind: 'video', id: 'placed', sourceId, title: 'Placed', sequenceId: 'cut',
		sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 180, retimeMap: null };
	const project = createFramescaperProject(PROFILE, { id: 'secondary-target', sources: [source], clips: [clip],
		projectBin: { clips: [{ ...clip, id: 'bin', binItemId: 'item' }] },
		tracks: [{ id: 'primary-pictures', type: 'video', clipIds: [] }, { id: 'pictures', type: 'video', clipIds: ['placed'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['primary-pictures'] },
			{ id: 'cut', rate: { num: 25, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	await environment.store.writeMediaAsset(sourceId, new Blob([Uint8Array.from(file.buffer)], { type: 'video/webm' }), {
		name: file.name, mimeType: 'video/webm',
	});
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = await createFramescaperFixtureController(environment, project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	controller.actions.timeline.selectTrack(explicit ? 'primary-pictures' : 'pictures');
	if (explicit) controller.actions.video.toggleTarget('pictures');
	assert.deepEqual(controller.actions.video.targets(), { sequenceId: 'cut', videoTrackId: 'pictures', audioTrackId: null, explicit });
	assert.equal(controller.actions.video.targets('main').videoTrackId, null, 'an explicit primary lookup never receives a secondary track');
	controller.actions.video.toggleTarget('pictures');
	assert.equal(controller.actions.video.targets().videoTrackId, null, 'Target can intentionally disable the selected lane');
	assert.throws(() => controller.actions.video.overwrite({ binItemId: 'item' }), /No video lane/u);
	controller.actions.video.toggleTarget('pictures');
	const before = controller.project; assert.ok(before);
	const result = controller.actions.video.overwrite({ binItemId: 'item' });
	assert.equal(result.edit.sequenceFrameCount, 150);
	const written = controller.project?.clips.find(value => value.id === result.videoClipId);
	assert.ok(written && written.kind === 'video');
	assert.equal(written.sequenceId, 'cut'); assert.equal(written.sequenceFrameCount, 150); assert.equal(written.sourceFrameCount, 180);
	assert.deepEqual(controller.project?.tracks.find(track => track.id === 'primary-pictures')?.clipIds, []);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.equal(controller.project?.clips[0]?.id, result.videoClipId);
	controller.actions.video.clearTargets();
	assert.equal(controller.actions.video.targets().sequenceId, explicit ? 'main' : 'cut');
	await controller.actions.project.create();
	assert.equal(controller.actions.video.targets().explicit, false, 'a different project retires old target choices');
});
