/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createTrackSelectionContextMenuItems } from '../src/common/editor/ui/timeline/track-selection-context-menu.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP19 ancillary: Make Stereo cannot consume a hidden track from another sequence', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-mono-partner-scope' });
	const source = createAudioSource({ id: 'source', frameCount: 8, channelCount: 1, sampleRate: 48_000 });
	const writer = await store.beginSourceWrite(source.id, source); await writer.write([new Float32Array(8).fill(0.25)]); await writer.commit();
	const clips = ['left', 'hidden'].map((id) => createAudioClip({ id: `${id}-clip`, sourceId: source.id,
		timelineStartFrame: 0, durationFrames: 8, sourceDurationFrames: 8 }));
	const project = createSoundscaperProject({ id: 'partner-scope', sources: [source], clips,
		tracks: ['left', 'hidden'].map((id) => createAudioTrack({ id, clipIds: [`${id}-clip`] })), primarySequenceId: 'main',
		sequences: [{ id: 'main', trackNodes: [{ kind: 'track', id: 'left', parentFolderId: null }] },
			{ id: 'inactive', trackNodes: [{ kind: 'track', id: 'hidden', parentFolderId: null }] }] });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	const items = createTrackSelectionContextMenuItems({ project, track: project.tracks[0]!, copy: COPY,
		audioEffects: true, blocked: false, actions: { makeStereo: () => undefined } });
	assert.equal(items.audio[0]?.items?.find(({ id }) => id === 'track-make-stereo')?.disabled, true);
	await assert.rejects(controller.actions.track.makeStereo('left'), /mono tracks/iu);
	assert.deepEqual(controller.project?.tracks.map(({ id }) => id), ['left', 'hidden']);
});
