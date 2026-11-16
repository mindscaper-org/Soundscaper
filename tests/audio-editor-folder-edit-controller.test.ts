/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { folderEditProject } from './helpers/folder-edit-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
async function fixture(context: TestContext) {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const { project, source } = folderEditProject();
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(source.frameCount).fill(.25)]);
	await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const archive = await exportScapeProject(project, store);
	assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Folder.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	return controller;
}

function currentProject(controller: ReturnType<typeof createAudioEditorController>) {
	const project: unknown = controller.project;
	assert.ok(validateSoundscaperProject(project));
	return project;
}

function clipCount(controller: ReturnType<typeof createAudioEditorController>, trackId: string): number {
	const track = currentProject(controller).tracks.find(candidate => candidate.id === trackId);
	assert.ok(track?.type === 'audio');
	return track.clipIds.length;
}

test('select folder contents selects collapsed nested media and clears outside clip focus', async context => {
	const controller = await fixture(context);
	controller.actions.timeline.selectClip('music-first');
	controller.actions.edit.execute('folder-select', { folderId: 'dialogue', propagateErrors: true });
	assert.deepEqual(currentProject(controller).selection.trackIds, ['voice', 'ambience']);
	assert.deepEqual(currentProject(controller).selection.clipIds, []);
	assert.equal(currentProject(controller).selection.startFrame, 0);
	assert.equal(currentProject(controller).selection.endFrame, 192_000);
});

for (const action of ['delete', 'ripple-delete', 'ripple-cut'] as const) test(`folder ${action} edits nested children once and leaves outside audio fixed`, async context => {
	const controller = await fixture(context);
	controller.actions.timeline.setExactSelection(12_000, 36_000, { trackIds: ['music'] });
	const before = currentProject(controller);
	controller.actions.edit.execute(`folder-${action}`, { folderId: 'dialogue', propagateErrors: true });
	const result = resolveRuntimeProjectProjection(currentProject(controller));
	assert.equal(result.clips.find(clip => clip.id === 'voice-later')?.timelineStartFrame, action === 'delete' ? 144_000 : 120_000);
	assert.equal(result.clips.find(clip => clip.id === 'ambience-later')?.timelineStartFrame, action === 'delete' ? 144_000 : 120_000);
	assert.deepEqual(result.clips.filter(clip => String(clip.id).startsWith('music')), resolveRuntimeProjectProjection(before).clips.filter(clip => String(clip.id).startsWith('music')));
	if (action === 'ripple-cut') assert.equal(controller.getSnapshot().history.hasClipboard, true);
	controller.actions.edit.undo();
	assert.deepEqual(resolveRuntimeProjectProjection(currentProject(controller)).clips, resolveRuntimeProjectProjection(before).clips);
	controller.actions.edit.redo();
	assert.deepEqual(resolveRuntimeProjectProjection(currentProject(controller)).clips, result.clips);
});

test('folder split uses both selected boundaries and is one undoable edit', async context => {
	const controller = await fixture(context);
	controller.actions.timeline.setExactSelection(12_000, 36_000, { trackIds: ['music'] });
	controller.actions.edit.execute('folder-split', { folderId: 'dialogue', propagateErrors: true });
	assert.equal(clipCount(controller, 'voice'), 4);
	assert.equal(clipCount(controller, 'ambience'), 4);
	assert.equal(clipCount(controller, 'music'), 2);
	controller.actions.edit.undo();
	assert.equal(resolveRuntimeProjectProjection(currentProject(controller)).clips.length, 6);
});

test('one-track clipboard ripple insertion shifts every folder child including a clip spanning the insertion', async context => {
	const controller = await fixture(context);
	controller.actions.timeline.setExactSelection(0, 12_000, { trackIds: ['music'] });
	controller.actions.edit.copy();
	controller.actions.timeline.setExactSelection(24_000, 24_000, { trackIds: ['voice', 'ambience'] });
	controller.actions.transport.seek(24_000);
	await controller.actions.edit.execute('folder-ripple-insert', { folderId: 'dialogue', propagateErrors: true });
	const result = resolveRuntimeProjectProjection(currentProject(controller));
	assert.equal(result.clips.find(clip => clip.id === 'voice-later')?.timelineStartFrame, 156_000);
	assert.equal(result.clips.find(clip => clip.id === 'ambience-later')?.timelineStartFrame, 156_000);
	assert.equal(result.clips.find(clip => clip.id === 'music-later')?.timelineStartFrame, 144_000);
	assert.equal(clipCount(controller, 'ambience'), 3);
	controller.actions.edit.undo();
	assert.equal(resolveRuntimeProjectProjection(currentProject(controller)).clips.length, 6);
});

test('folder shortcut actions use the selected folder and refuse locked nested tracks without changing history', async context => {
	const controller = await fixture(context);
	controller.actions.trackFolders.select('dialogue');
	controller.actions.edit.folderSelect();
	assert.deepEqual(currentProject(controller).selection.trackIds, ['voice', 'ambience']);
	controller.actions.track.update('ambience', { locked: true });
	const before = controller.project;
	assert.throws(() => controller.actions.edit.execute('folder-ripple-cut', { folderId: 'dialogue', propagateErrors: true }), /locked/u);
	assert.deepEqual(controller.project, before);
	assert.equal(controller.getSnapshot().history.hasClipboard, false);
});

test('folder insertion refuses an oversized clipboard atomically', async context => {
	const controller = await fixture(context);
	controller.actions.timeline.setExactSelection(0, 12_000, { trackIds: ['voice', 'ambience', 'music'] });
	controller.actions.edit.copy();
	const before = controller.project;
	assert.throws(() => controller.actions.edit.execute('folder-ripple-insert', { folderId: 'dialogue', propagateErrors: true }), /matching tracks/u);
	assert.deepEqual(controller.project, before);
});

test('scoped insertion carries automation even on a descendant with no clips', async context => {
	const controller = await fixture(context);
	controller.actions.timeline.setExactSelection(0, 12_000, { trackIds: ['music'] });
	controller.actions.edit.copy();
	controller.actions.edit.commit({ type: 'clip/remove-many', clipIds: ['ambience-first', 'ambience-later'], rippleMode: 'none' });
	controller.actions.edit.commit({ type: 'automation-lane/set', laneId: 'empty-track-gain', expected: null,
		lane: normalizeAutomationLaneV21({ id: 'empty-track-gain', address: { kind: 'strip', strip: { kind: 'track', id: 'ambience' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 1 }, { id: 'later', position: 144_000, value: .5 }], segments: [{ kind: 'linear' }] }) });
	controller.actions.timeline.setExactSelection(24_000, 24_000, { trackIds: ['voice', 'ambience'] });
	controller.actions.transport.seek(24_000);
	await controller.actions.edit.execute('folder-ripple-insert', { folderId: 'dialogue', propagateErrors: true });
	const result = currentProject(controller);
	assert.equal(result.automationLanes.find(lane => lane.id === 'empty-track-gain')?.points.find(point => point.id === 'later')?.position, 156_000);
});
