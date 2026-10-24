/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { scaleClipEnvelope } from '../src/common/editor/controller/source/source-audio.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const operation of ['speed', 'stretch'] as const) test(`${operation} keeps the departing gain when two envelope points share a rescaled sample`, async context => {
	const envelope = [{ frame: 0, value: .2 }, { frame: 10000, value: .1 }, { frame: 10001, value: .9 }, { frame: 48000, value: .9 }];
	const source = createAudioSource({ id: 'recording', sampleRate: 48000, channelCount: 1, frameCount: 48000 });
	const project = createSoundscaperProject({ id: `speed-envelope-${operation}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48000, sourceDurationFrames: 48000, envelope, linkPitchAndTempo: true })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	await store.saveProject(project); await store.saveSetting('last-project-id', project.id);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	controller.actions.timeline.selectClip('clip');
	if (operation === 'speed') controller.actions.clip.setTimePitch('clip', { speedRatio: 10 });
	else controller.actions.clip.stretch('clip', { durationFrames: 4800 });
	const after = controller.project; assert.ok(after);
	assert.deepEqual(after.clips[0]?.envelope, [{ frame: 0, value: .2 }, { frame: 1000, value: .9 }, { frame: 4800, value: .9 }]);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips[0]?.envelope, envelope);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
});

test('rescaling keeps noncolliding points and the last authored value at a collapsed tail', () => {
	assert.deepEqual(scaleClipEnvelope({ durationFrames: 1000, envelope: [
		{ frame: 0, value: .2 }, { frame: 500, value: .5 }, { frame: 999, value: .9 }, { frame: 1000, value: .1 },
	] }, 100), [{ frame: 0, value: .2 }, { frame: 50, value: .5 }, { frame: 100, value: .1 }]);
});
