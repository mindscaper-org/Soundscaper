/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createProjectSessionSelectionService } from '../src/common/editor/controller/document/internal/project/project-session-selection-service.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { createMemoryFfmpeg, waitFor } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController } from './helpers/audio-editor-controller-harness.js';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';

test('MP07: opening a project restores its durable active track and annotation selection', () => {
	const project = createSoundscaperProject({ id: 'project',
		tracks: [createAudioTrack({ id: 'first' }), createAudioTrack({ id: 'second' })],
		timelineAnnotations: [{ id: 'cue', sequenceId: 'main-sequence', kind: 'marker', anchor: 'sample',
			positionFrame: 0, name: 'Cue', color: 'auto', batchId: null, opaqueExtensions: {} }],
		selection: { trackIds: ['second'], annotationIds: ['cue'] },
	});
	const state = { selectedTrackId: null as string | null, selectedClipId: null as string | null,
		selectedAnnotationId: null as string | null, selectedLabels: [] };
	const service = createProjectSessionSelectionService({ state,
		findTrack: (value: typeof project, id) => value.tracks.find((track) => track.id === id) ?? null,
		findClip: () => null,
	});
	service.restore(project);
	assert.equal(state.selectedTrackId, 'second');
	assert.equal(state.selectedAnnotationId, 'cue');
});

async function openTabFixture(context: TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const engine = createAudioEditorEngine();
	const store = createMemoryStore();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, engine,
		store: store as unknown as Options['store'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(() => controller.dispose());
	await controller.ready;
	return { controller, engine, store, firstId: controller.project!.id };
}

test('the transport playhead returns to the position last used in each project tab', async context => {
	const { controller, engine, firstId } = await openTabFixture(context);
	await controller.actions.transport.seek(24_000);
	await controller.actions.project.create({ title: 'Second project' });
	const secondId = controller.project!.id;
	assert.equal(engine.getPositionFrames(), 0, 'the new tab starts at the beginning');
	await controller.actions.transport.seek(12_000);
	await controller.actions.project.openById(firstId);
	assert.equal(engine.getPositionFrames(), 24_000);
	await controller.actions.project.openById(secondId);
	assert.equal(engine.getPositionFrames(), 12_000);
});

test('the timeline zoom stays with the tab where it was changed', async context => {
	const { controller, firstId } = await openTabFixture(context);
	const initialZoom = controller.getSnapshot().timeline.pixelsPerSecond;
	controller.actions.timeline.zoomIn();
	const firstZoom = controller.getSnapshot().timeline.pixelsPerSecond;
	assert.ok(firstZoom > initialZoom);
	await controller.actions.project.create({ title: 'Second project' });
	assert.equal(controller.getSnapshot().timeline.pixelsPerSecond, initialZoom);
	controller.actions.timeline.zoomOut();
	const secondZoom = controller.getSnapshot().timeline.pixelsPerSecond;
	const secondId = controller.project!.id;
	await controller.actions.project.openById(firstId);
	assert.equal(controller.getSnapshot().timeline.pixelsPerSecond, firstZoom);
	await controller.actions.project.openById(secondId);
	assert.equal(controller.getSnapshot().timeline.pixelsPerSecond, secondZoom);
});

test('Undo and Redo focus a clip belonging to their restored selection', async context => {
	const { controller, store } = await openTabFixture(context);
	const clip = (id: string) => createAudioClip({ id, sourceId: 'source', durationFrames: 24_000 });
	const project = createCurrentAudioEditorProject({ id: 'focus-history', title: 'Before edit',
		sources: [createAudioSource({ id: 'source', frameCount: 24_000, channelCount: 1, sampleRate: 48_000 })],
		clips: [clip('first-clip'), clip('second-clip')],
		tracks: [createAudioTrack({ id: 'first-track', clipIds: ['first-clip'] }),
			createAudioTrack({ id: 'second-track', clipIds: ['second-clip'] })],
	});
	await store.saveProject(project);
	await controller.actions.project.openById(project.id);
	controller.actions.timeline.selectClip('first-clip');
	await controller.actions.project.rename('After edit');
	controller.actions.timeline.selectClip('second-clip');

	controller.actions.edit.undo();
	const undone = controller.getSnapshot();
	assert.deepEqual(undone.project?.selection?.clipIds, ['first-clip']);
	assert.equal(undone.selectedClipId, 'first-clip');
	assert.equal(undone.selectedTrackId, 'first-track');

	controller.actions.edit.redo();
	const redone = controller.getSnapshot();
	assert.deepEqual(redone.project?.selection?.clipIds, ['second-clip']);
	assert.equal(redone.selectedClipId, 'second-clip');
	assert.equal(redone.selectedTrackId, 'second-track');
});

test('Split for a context clip uses the cursor and its group while Edit Split uses the range', async context => {
	const { controller, store } = await openTabFixture(context);
	const source = (id: string) => createAudioSource({ id, frameCount: 24_000, channelCount: 1, sampleRate: 48_000 });
	const clip = (id: string, groupId: string | null) => createAudioClip({ id, sourceId: `${id}-source`, durationFrames: 24_000, groupId });
	const project = createCurrentAudioEditorProject({ id: 'context-split',
		sources: ['target', 'unrelated', 'companion'].map(id => source(`${id}-source`)),
		clips: [clip('target', 'group'), clip('unrelated', null), clip('companion', 'group')],
		tracks: [createAudioTrack({ id: 'target-lane', clipIds: ['target', 'unrelated'] }),
			createAudioTrack({ id: 'companion-lane', clipIds: ['companion'] })],
	});
	await store.saveProject(project);
	await controller.actions.project.openById(project.id);
	controller.actions.timeline.selectClip('target');
	controller.actions.transport.toggleSelectionFollowsLoop();
	controller.actions.transport.setLoopRegion(2_000, 8_000);
	await controller.actions.transport.seek(4_800);
	const starts = (id: string) => controller.project!.clips.filter(item => item.sourceId === `${id}-source`)
		.map(item => item.timelineStartFrame).sort((left, right) => left - right);

	controller.actions.edit.split('target');
	assert.deepEqual(starts('target'), [0, 4_800]);
	assert.deepEqual(starts('companion'), [0, 4_800]);
	assert.deepEqual(starts('unrelated'), [0]);
	controller.actions.edit.undo();
	assert.equal(controller.project!.clips.length, 3);
	controller.actions.edit.split();
	assert.deepEqual(starts('target'), [0, 2_000, 8_000]);
	assert.deepEqual(starts('companion'), [0, 2_000, 8_000]);
	assert.deepEqual(starts('unrelated'), [0, 2_000, 8_000]);
});

test('whole-track spectral displays follow the active tab and its undo history', async context => {
	const { controller, firstId } = await openTabFixture(context);
	const view = () => controller.getSnapshot().timeline.view;
	await controller.actions.project.create({ title: 'Second project' });
	const secondId = controller.project!.id;
	await controller.actions.project.openById(firstId);

	for (const mode of ['spectrogram', 'multiview'] as const) {
		assert.equal(view(), 'waveform');
		controller.actions.timeline.setAllTracksView(mode);
		assert.equal(view(), mode);
		await controller.actions.project.openById(secondId);
		assert.equal(view(), 'waveform');
		await controller.actions.project.openById(firstId);
		assert.equal(view(), mode);
		controller.actions.edit.undo();
		assert.equal(view(), 'waveform');
		controller.actions.edit.redo();
		assert.equal(view(), mode);
		controller.actions.edit.undo();
	}
});

test('temporary working-copy cleanup retires deleted entries from Recent Projects', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createSoundscaperEphemeralProjectStore();
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store, engine: createAudioEditorEngine(), ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(() => controller.dispose());
	await controller.ready;
	await controller.actions.project.rename('Old edit');
	const oldId = controller.project!.id;
	await controller.actions.project.create({ title: 'New edit' });
	const activeId = controller.project!.id;
	assert.ok(controller.getSnapshot().recentProjects.some(project => project.id === oldId));
	await controller.actions.preferences.update({ temporaryData: { limitProjects: true, maximumProjects: 1 } });
	await controller.actions.project.close(oldId);
	await waitFor(() => !controller.getSnapshot().recentProjects.some(project => project.id === oldId));
	assert.equal(await store.loadProject(oldId), null);
	assert.ok(controller.getSnapshot().recentProjects.some(project => project.id === activeId));
});
