/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { commitStagedClipboardPaste } from '../src/common/editor/controller/edit/internal/commit-staged-clipboard-paste.ts';

test('ordinary Copy and Paste transfer image bodies atomically across projects and source ID collisions', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const placement = { scope: 'timeline' as const, trackId: 'video-track' };
	const base = applyFramescaperProjectCommand(PROFILE, fixture.project, { type: 'batch', commands: [
		{ type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: fixture.clip, expectedPlacement: placement, clip: null, placement: null },
		{ type: 'image-source/set', sourceId: fixture.source.id, expectedSource: fixture.source, source: null },
	] });
	assert.ok(await environment.createProjectIfAbsent(base));
	const authored = applyFramescaperProjectCommand(PROFILE, base, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: fixture.source.id, expectedSource: null, source: fixture.source },
		{ type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: null, expectedPlacement: null, clip: fixture.clip, placement },
	] });
	assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes: fixture.bytes }));
	const destinationOptions = framescaperBaselineOptions();
	destinationOptions.id = 'image-paste-destination';
	destinationOptions.sources = [{ id: fixture.source.id, sampleRate: 48_000, channelCount: 1, frameCount: 1 }];
	destinationOptions.clips = [{ id: 'collision-audio', sourceId: fixture.source.id, timelineStartFrame: 0, durationFrames: 1, sourceStartFrame: 0, sourceDurationFrames: 1 }];
	destinationOptions.projectBin = { clips: [] };
	destinationOptions.tracks = (destinationOptions.tracks as Record<string, unknown>[]).map(track => ({ ...track, clipIds: track.type === 'audio' ? ['collision-audio'] : [] }));
	const destination = createFramescaperProject(PROFILE, destinationOptions);
	const audio = destination.sources.find(source => source.id === fixture.source.id)!;
	const writer = await environment.store.beginSourceWrite(audio.id, audio);
	await writer.write([Float32Array.of(0.25)]); await writer.commit();
	assert.ok(await environment.createProjectIfAbsent(destination));
	const controller = await createFramescaperFixtureController(environment, fixture.project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	controller.actions.timeline.selectClip(fixture.clip.id);
	controller.actions.edit.copy();
	await controller.actions.project.openById(destination.id);
	await controller.actions.edit.paste();
	const image = controller.project?.clips.find(clip => clip.kind === 'image');
	assert.ok(image, `the public paste action publishes the selected image: ${JSON.stringify(controller.getSnapshot().status)}`);
	assert.notEqual(image.sourceId, fixture.source.id, 'the existing audio source retains its identity');
	const source = controller.project?.sources.find(source => source.id === image.sourceId);
	assert.ok(source && source.kind === 'image');
	const body = await environment.store.loadMediaAsset(source.storageKey);
	assert.ok(body); assert.deepEqual(new Uint8Array(await body.arrayBuffer()), fixture.bytes);
	controller.actions.edit.undo();
	assert.equal(controller.project?.clips.filter(clip => clip.kind === 'image').length, 0);
	controller.actions.edit.redo();
	assert.equal(controller.project?.clips.filter(clip => clip.kind === 'image').length, 1);
});

test('a refused paste rolls back staged bodies and preserves cleanup failures', async () => {
	let rollbacks = 0; let completed = false;
	const refusal = new Error('publication refused');
	const stage = { complete() { completed = true; }, rollback() { rollbacks += 1; } };
	await assert.rejects(Promise.resolve(commitStagedClipboardPaste({ stage: async () => stage, assertCurrent() {}, commit() { throw refusal; } })), error => error === refusal);
	assert.equal(rollbacks, 1); assert.equal(completed, false);
	await assert.rejects(Promise.resolve(commitStagedClipboardPaste({ stage: async () => ({ ...stage, rollback() { throw new Error('cleanup refused'); } }), assertCurrent() {}, commit() { throw refusal; } })), AggregateError);
});
