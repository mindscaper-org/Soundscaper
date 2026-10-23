/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';

for (const firstId of ['a:b', 'ordinary']) test(`a live effect gesture on ${firstId} only previews its owning clip`, async context => {
	const source = createVideoSource({ id: 'camera', name: 'Camera', storageKey: 'camera', mimeType: 'video/webm',
		contentSha256: '12'.repeat(32), sourceFrameCount: 20, sampleFrameCount: 96_000,
		frameRate: { num: 10, den: 1 }, width: 16, height: 16 });
	const ids = [firstId, 'a'];
	const project = createFramescaperProject(PROFILE, { id: `gesture-${firstId}`, sources: [source],
		clips: ids.map((id, index) => ({ kind: 'video', id, sourceId: source.id, title: `Picture ${String(index + 1)}`,
			sequenceId: 'main', sequenceStartFrame: index * 10, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
			videoEffects: [createVideoEffect('color-adjust', { id: index === 0 ? 'c' : 'b:c' })] })),
		tracks: [{ id: 'pictures', type: 'video', clipIds: ids }],
		sequences: [{ id: 'main', rate: { num: 10, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = await createFramescaperFixtureController(environment, project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	const effects = controller.actions.video.effects;
	assert.ok(effects);
	controller.actions.timeline.selectClip(firstId);
	effects.beginGesture(firstId, 'c');
	effects.preview(firstId, 'c', { brightness: 0.4 });
	const snapshot: unknown = controller.getSnapshot();
	assert.ok(snapshot && typeof snapshot === 'object' && 'project' in snapshot);
	const preview = snapshot.project;
	assert.ok(preview && typeof preview === 'object' && 'clips' in preview && Array.isArray(preview.clips));
	assert.deepEqual(brightnessOf(preview.clips), [0.4, 0]);
	effects.commit(firstId, 'c');
	assert.deepEqual(brightnessOf(controller.project?.clips ?? []), [0.4, 0]);
	controller.actions.edit.undo();
	assert.deepEqual(brightnessOf(controller.project?.clips ?? []), [0, 0]);
});

function brightnessOf(clips: readonly unknown[]): unknown[] {
	return clips.map((clip: unknown) => {
		assert.ok(clip && typeof clip === 'object' && 'videoEffects' in clip && Array.isArray(clip.videoEffects));
		const effect: unknown = clip.videoEffects[0];
		assert.ok(effect && typeof effect === 'object' && 'params' in effect);
		const params = effect.params; assert.ok(params && typeof params === 'object' && 'brightness' in params);
		return params.brightness;
	});
}
