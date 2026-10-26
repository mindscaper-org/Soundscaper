/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperProject, cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { normalizeVideoColorContextV1 } from '../src/common/editor/video-color-management-v27.ts';
import { normalizeFramescaperImageClipV1 } from '../src/common/editor/timeline-image-model.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

for (const rate of [25, 30, 60]) test(`moving a ${rate}fps secondary title to30fps preserves five seconds`, async context => {
	const project = createFramescaperProject(PROFILE, { id: `visual-bin-${rate}`, visualModel: { generatorSources: [{
		schemaVersion: 1, kind: 'generator', id: 'title-source', name: 'Title', width: 1920, height: 1080,
		frameRate: { num: rate, den: 1 }, frameCount: rate * 5, generator: { kind: 'solid', color: '#ffffffff' },
	}] }, clips: [{ schemaVersion: 1, kind: 'generator', id: 'title', sourceId: 'title-source', sequenceId: 'cut',
		sequenceStartFrame: 0, sequenceFrameCount: rate * 5, sourceInFrame: 0, sourceFrameCount: rate * 5 }],
	tracks: [{ id: 'target', name: 'Main destination', type: 'video', clipIds: [] }, { id: 'pictures', type: 'video', clipIds: ['title'] }],
	sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['target'] },
		{ id: 'cut', rate: { num: rate, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = await createFramescaperFixtureController(environment, project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const before = controller.project; assert.ok(before);
	controller.actions.clip.move('title', 'target', 0, { preserveTime: true });
	const placed = controller.project?.clips.find(value => value.id === 'title'); assert.ok(placed);
	assert.equal(placed.sequenceId, 'main'); assert.equal(placed.sequenceFrameCount, 150);
	assert.equal(placed.sourceFrameCount, rate * 5);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips.find(value => value.id === 'title'), placed);
});

test('an animated image move preserves physical duration and exact source phase on a different sequence grid', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const sequence = fixture.project.sequences[0]; assert.ok(sequence);
	assert.deepEqual(sequence.rate, { num: 10, den: 1 });
	const track = fixture.project.tracks.find(value => value.type === 'video'); assert.ok(track);
	const placement = { scope: 'timeline' as const, trackId: track.id };
	const authored = applyFramescaperProjectCommand(PROFILE, fixture.project, { type: 'image-clip/set',
		clipId: fixture.clip.id, expectedClip: fixture.clip, expectedPlacement: placement,
		clip: { ...fixture.clip, sourceStartFraction: { num: '1', den: '3' } }, placement });
	assert.ok(Array.isArray(authored.videoColorContexts));
	const contexts = authored.videoColorContexts.map(normalizeVideoColorContextV1);
	const context = contexts[0]; assert.ok(context);
	const project = cloneFramescaperProject(PROFILE, { ...authored,
		videoColorContexts: [...contexts, { ...context, sequenceId: 'destination' }],
		tracks: [...authored.tracks, { ...track, id: 'destination-track', name: 'Destination', clipIds: [] }],
		sequences: [...authored.sequences, { ...sequence, id: 'destination', rate: { num: 30, den: 1 },
			trackIds: ['destination-track'], trackNodes: [{ kind: 'track', id: 'destination-track', parentFolderId: null }] }],
	});
	const moved = applyFramescaperProjectCommand(PROFILE, project, { type: 'clip/move', clipId: fixture.clip.id,
		trackId: 'destination-track', timelineStartFrame: 96_000 });
	const clip = normalizeFramescaperImageClipV1(moved.clips.find(value => value.id === fixture.clip.id));
	assert.equal(clip.sequenceId, 'destination');
	assert.equal(clip.sequenceStartFrame, 60);
	assert.equal(clip.sequenceFrameCount, 450);
	assert.equal(clip.sourceStartTicks, fixture.clip.sourceStartTicks);
	assert.deepEqual(clip.sourceStartFraction, { num: '1', den: '3' });
	assert.deepEqual(moved.sources, project.sources);
	assert.equal(project.clips.find(value => value.id === fixture.clip.id)?.sequenceFrameCount, 150);
});
