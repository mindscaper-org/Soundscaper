/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createClipSelectionNavigationService, type ClipSelectionNavigationSelectionCommand } from '../src/common/editor/controller/track-audio/internal/clip-selection-navigation-service.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

function navigationProject() {
	const source = createAudioSource({ id: 'source', frameCount: 10, channelCount: 1, sampleRate: 48_000 });
	const clips = [['current', 0], ['next', 100], ['other', 50]].map(([id, start]) => createAudioClip({
		id: String(id), sourceId: source.id, timelineStartFrame: Number(start), sourceDurationFrames: 10, durationFrames: 10,
	}));
	const tracks = [createAudioTrack({ id: 'active', clipIds: ['current', 'next'] }),
		createAudioTrack({ id: 'inactive', clipIds: ['other'] })];
	return createSoundscaperProject({ id: 'project', sources: [source], clips, tracks,
		primarySequenceId: 'main', sequences: [
			{ id: 'main', trackNodes: [{ kind: 'track', id: 'active', parentFolderId: null }] },
			{ id: 'other-sequence', trackNodes: [{ kind: 'track', id: 'inactive', parentFolderId: null }] },
		], selection: { startFrame: 0, endFrame: 10, trackIds: [], clipIds: ['current'] },
	});
}

test('MP19: next-clip navigation in an opened project excludes other sequences', () => {
	const project = navigationProject();
	let selected: ClipSelectionNavigationSelectionCommand | null = null;
	const service = createClipSelectionNavigationService({ getProject: () => project,
		state: { selectedTrackId: null, selectedClipId: 'current', selectedAnnotationId: null },
		updateSelection: (command) => { selected = command; return command; }, seek() {},
	});
	service.selectNextClip();
	assert.deepEqual((selected as ClipSelectionNavigationSelectionCommand | null)?.clipIds, ['next']);
});

test('MP19 controller navigation and track moves stay in the opened primary sequence', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-project-navigation' }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.open(navigationProject());
	controller.actions.timeline.selectNoTracks();
	controller.actions.timeline.selectNextClip();
	assert.equal(controller.getSnapshot().selectedClipId, 'next');
	const runtime = createAudacityActionRuntime(controller);
	context.after(() => runtime.dispose());
	controller.actions.timeline.selectClip('current');
	assert.equal(await runtime.actions.navigation.nextItem(), 'next');
	assert.equal(runtime.actions.navigation.lastTrack(), 'active');
	controller.actions.timeline.selectClip('next');
	await runtime.actions.navigation.moveItemDown();
	assert.deepEqual(controller.project?.tracks.find((track) => track.id === 'inactive')?.clipIds, ['other']);
	assert.doesNotThrow(() => controller.actions.track.moveDown('active'), 'track context down is inert at its sequence boundary');
	assert.doesNotThrow(() => controller.actions.track.moveBottom('active'), 'track context bottom stays in its sequence');
});
