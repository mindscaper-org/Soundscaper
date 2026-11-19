/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createMenuActionFixture, findMenuItem } from './helpers/application-menu-fixture.ts';
import { currentReviewedVideoProject } from './helpers/reviewed-video-project-custody.ts';
import { reopenVisualAuthoringArchive } from './helpers/framescaper-visual-authoring-archive-custody.ts';
import { normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { framescaperPublishedProject } from './helpers/framescaper-controller-project-fixture.ts';
import { normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const mode of ['overwrite', 'overwrite-middle', 'insert-middle'] as const) test(`Title ${mode} Paste owns native collisions and one complete Undo`, async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(authoring);
	await authoring.run('video-title');
	const before = framescaperPublishedProject(controller.project);
	const original = normalizeVideoGeneratorClipV1(before.clips.at(-1));
	controller.actions.timeline.selectClip(original.id);
	await controller.actions.edit.copy();
	assert.notEqual(controller.getSnapshot().status.state, 'error');
	if (mode !== 'overwrite') controller.actions.transport.seek(120_000);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	await (mode === 'insert-middle' ? controller.actions.edit.pasteInsert() : controller.actions.edit.pasteOverlap());
	assert.notEqual(controller.getSnapshot().status.state, 'error', JSON.stringify(controller.getSnapshot().status));
	const after = framescaperPublishedProject(controller.project);
	assert.equal(after.tracks.length, before.tracks.length);
	const clips = (after.clips as readonly Readonly<Record<string, unknown>>[])
		.filter(clip => clip.kind === 'generator').map(normalizeVideoGeneratorClipV1)
		.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
	const duration = original.sequenceFrameCount;
	const middle = duration / 2;
	assert.equal(clips.length, mode === 'overwrite' ? 1 : mode === 'overwrite-middle' ? 2 : 3);
	const copy = clips.find(clip => clip.sourceId !== original.sourceId);
	assert.ok(copy);
	assert.equal(copy.sequenceStartFrame, mode === 'overwrite' ? 0 : middle);
	assert.equal(copy.sequenceFrameCount, duration);
	assert.equal(copy.sourceInFrame, original.sourceInFrame);
	assert.equal(copy.sourceFrameCount, original.sourceFrameCount);
	const survivors = clips.filter(clip => clip.sourceId === original.sourceId);
	assert.deepEqual(survivors.map(clip => [clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceInFrame, clip.sourceFrameCount]), mode === 'overwrite' ? []
		: mode === 'overwrite-middle' ? [[0, middle, 0, middle]] : [[0, middle, 0, middle], [middle + duration, middle, middle, middle]]);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.tracks, after.tracks);
});


interface MenuItem { readonly id?: unknown; readonly items?: readonly MenuItem[]; readonly disabled?: unknown; readonly onClick?: unknown; readonly label?: unknown }
function titleDocument(value: unknown) {
	const { revision: _revision, updatedAt: _updatedAt, selection: _selection, ...document } = currentReviewedVideoProject(value); return document;
}

// These are the production File/Edit menus and the same controller-backed adapter used by the workspace.
async function clickTitleMenu(controller: ReturnType<typeof createFramescaperAudioEditorController>, environment: Awaited<ReturnType<typeof createFramescaperEditorProjectEnvironment>>, id: string) {
	const current = currentReviewedVideoProject(controller.project), project = environment.runtime.projectForRuntimeConsumers(current);
	const snapshot = { ...controller.getSnapshot(), project };
	const actions = createMenuActionFixture({ installAvailable: () => false,
		executeEdit: (action: string) => {
			const operation: unknown = Reflect.get(controller.actions.edit, action); assert.ok(typeof operation === 'function');
			return Reflect.apply(operation, controller.actions.edit, []);
		},
		saveProject: () => controller.actions.project.saveFile(),
	}, action => assert.fail(`Unexpected menu action: ${action}`));
	const menus = createApplicationMenus({ productId: 'framescaper', aboutLabel: 'About Framescaper', capabilities: snapshot.capabilities,
		locale: 'en', copy: ENGLISH_COPY, project, snapshot, blocked: false, editBlocked: false, showArmControls: false,
		selectionActive: project.selection.endFrame > project.selection.startFrame,
		selectedClip: project.clips.find(clip => clip.id === snapshot.selectedClipId), durationFrames: 240_000,
		effectsPanelOpen: false, projectBinEffectivelyOpen: true, uiFlags: {}, actionRuntime: undefined, actions });
	const item = findMenuItem<MenuItem>(menus, id); assert.ok(item, id); assert.notEqual(item.disabled, true, id);
	const click = item.onClick; assert.ok(typeof click === 'function', id); await click();
}

test('ordinary Title Cut, real File Save and ordinary Paste retain clipboard/source custody and one-Undo collision', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const downloads: Blob[] = [];
	const controller = createFramescaperAudioEditorController(environment, { locale: 'en', copy: ENGLISH_COPY, fileService: {
		isDesktop: false, prepareSave: async () => ({ mode: 'blob', target: { browserDownload: true } }),
		saveFile: async (request: Readonly<Record<string, unknown>>) => { assert.equal(request.purpose, 'project'); assert.ok(request.blob instanceof Blob); downloads.push(request.blob); return { fileName: 'Title.fscape', size: request.blob.size }; },
	} });
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(authoring); await authoring.run('video-title');
	const before = currentReviewedVideoProject(controller.project), original = normalizeVideoGeneratorClipV1(before.clips.at(-1));
	const source = normalizeVideoGeneratorSourceV1(before.sources.find(value => value.id === original.sourceId));
	assert.deepEqual([original.sequenceStartFrame, original.sequenceFrameCount, original.sourceInFrame, original.sourceFrameCount], [0, 150, 0, 150]);
	assert.deepEqual([source.width, source.height, source.frameCount, source.frameRate], [1920, 1080, 150, { num: 30, den: 1 }]);
	assert.equal(source.generator.kind, 'title'); if (source.generator.kind !== 'title') assert.fail('The ordinary menu must generate a Title.'); assert.deepEqual(source.generator, { kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 96, color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle' });
	await controller.actions.timeline.selectClip(original.id);
	const initialEntries = controller.getSnapshot().history.undoEntries.length;
	await clickTitleMenu(controller, environment, 'action://cut');
	const cut = currentReviewedVideoProject(controller.project);
	assert.deepEqual(titleDocument(cut), { ...titleDocument(before), clips: [], sources: [], tracks: before.tracks.map(track => ({ ...track, clipIds: [] })),
		featureRequirements: { ...before.featureRequirements, requirements: before.featureRequirements.requirements.filter(value => value.id !== 'framescaper.video-generators') } });
	assert.equal(controller.getSnapshot().history.hasClipboard, true); assert.equal(controller.getSnapshot().history.undoEntries.length, initialEntries + 1);
	await clickTitleMenu(controller, environment, 'save-project');
	assert.equal(downloads.length, 1); assert.deepEqual(await environment.store.loadProject(cut.id), controller.project);
	const saved = JSON.parse(strFromU8(unzipSync(new Uint8Array(await downloads[0]!.arrayBuffer()))['project.json']!));
	assert.deepEqual(titleDocument(saved), titleDocument(cut)); assert.equal(controller.getSnapshot().history.hasClipboard, true);
	await clickTitleMenu(controller, environment, 'action://paste');
	const pasted = currentReviewedVideoProject(controller.project), firstCopy = normalizeVideoGeneratorClipV1(pasted.clips.at(-1));
	assert.equal(pasted.clips.length, 1); assert.equal(pasted.tracks.length, before.tracks.length); assert.notEqual(firstCopy.id, original.id);
	assert.deepEqual([firstCopy.sequenceId, firstCopy.sequenceStartFrame, firstCopy.sequenceFrameCount, firstCopy.sourceInFrame, firstCopy.sourceFrameCount], [original.sequenceId, 0, 150, 0, 150]);
	assert.deepEqual(normalizeVideoGeneratorSourceV1(pasted.sources.find(value => value.id === firstCopy.sourceId)).generator, source.generator);
	assert.deepEqual(titleDocument(pasted), { ...titleDocument(before), sources: [{ ...source, id: firstCopy.sourceId }],
		clips: before.clips.map(value => value.id === original.id ? { ...value, id: firstCopy.id, sourceId: firstCopy.sourceId } : value),
		tracks: before.tracks.map(track => ({ ...track, clipIds: Array.isArray(track.clipIds) ? track.clipIds.map(id => id === original.id ? firstCopy.id : id) : track.clipIds })),
	});
	assert.equal(controller.getSnapshot().history.undoEntries.length, initialEntries + 2);
	for (const expected of [cut, before]) { await clickTitleMenu(controller, environment, 'undo'); assert.deepEqual(titleDocument(controller.project), titleDocument(expected)); }
	await controller.actions.timeline.selectClip(original.id);
	await clickTitleMenu(controller, environment, 'copy');
	const entries = controller.getSnapshot().history.undoEntries.length;
	await clickTitleMenu(controller, environment, 'action://paste');
	const after = currentReviewedVideoProject(controller.project), copy = normalizeVideoGeneratorClipV1(after.clips.at(-1));
	assert.equal(after.clips.length, 1); assert.notEqual(copy.id, original.id); assert.notEqual(copy.sourceId, original.sourceId);
	assert.deepEqual(copy, { ...original, id: copy.id, sourceId: copy.sourceId });
	assert.deepEqual(normalizeVideoGeneratorSourceV1(after.sources.find(value => value.id === copy.sourceId)), { ...source, id: copy.sourceId });
	assert.deepEqual(after.tracks, before.tracks.map(track => ({ ...track, clipIds: Array.isArray(track.clipIds) ? track.clipIds.map(id => id === original.id ? copy.id : id) : track.clipIds })));
	assert.deepEqual(titleDocument(after), { ...titleDocument(before),
		sources: [...before.sources, { ...source, id: copy.sourceId }],
		clips: before.clips.map(value => value.id === original.id ? { ...value, id: copy.id, sourceId: copy.sourceId } : value),
		tracks: before.tracks.map(track => ({ ...track, clipIds: Array.isArray(track.clipIds) ? track.clipIds.map(id => id === original.id ? copy.id : id) : track.clipIds })),
	});
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	await clickTitleMenu(controller, environment, 'undo'); assert.deepEqual(titleDocument(controller.project), titleDocument(before));
	// Redo restores the canonical history document, which prunes the now-unused original generator source.
	const redone = { ...titleDocument(after), sources: [{ ...source, id: copy.sourceId }] };
	await clickTitleMenu(controller, environment, 'redo'); assert.deepEqual(titleDocument(controller.project), redone);
	await controller.actions.project.flush(); assert.deepEqual(await environment.store.loadProject(after.id), controller.project);
	assert.deepEqual(titleDocument(await reopenVisualAuthoringArchive(controller.project, environment.store)), redone);
	assert.notEqual(controller.getSnapshot().status.state, 'error');
});
