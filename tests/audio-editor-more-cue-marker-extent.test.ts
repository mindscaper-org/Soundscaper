/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { editorTimelineDurationFrames, projectDurationFrames } from '../src/common/editor/project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const withAudio of [false, true]) test(`imported CUE markers fit in the editor without extending ${withAudio ? 'existing' : 'empty'} audio delivery`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `cue-marker-extent-${withAudio}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	if (withAudio) await controller.actions.generators.generate('silence', { durationSeconds: 1, channelCount: 1 });
	const before = projectDurationFrames(controller.project);
	await controller.actions.labels.importCueFile(new File([
		'FILE "album.wav" WAVE\n TRACK 01 AUDIO\n TITLE "Ten minute cue"\n INDEX 01 10:00:00\n',
	], 'album.cue', { type: 'application/x-cue' }), 'markers');
	const project = controller.project; assert.ok(project);
	assert.equal(projectDurationFrames(project), before, 'annotation-only tail must not add rendered silence');
	assert.ok(editorTimelineDurationFrames(project) >= 600 * project.sampleRate, 'the editing timeline must reach the imported marker');
	controller.actions.timeline.setViewportWidth(600);
	controller.actions.timeline.zoomFit(600);
	assert.ok(600 * Number(controller.getSnapshot().timeline.pixelsPerSecond) <= 577, 'Fit project must leave room for the ruler inset and final marker glyph');
});

test('the real transport can seek to a CUE marker beyond the media ending', async context => {
	const { createAudioEditorEngine } = await import('../src/common/editor/engine.js');
	const { MockAudioContext } = await import('./helpers/mock-audio-context.js');
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const engine = createAudioEditorEngine({ audioContextFactory: () => new MockAudioContext() as unknown as AudioContext });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'cue-marker-real-seek' }),
		engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.labels.importCueFile(new File([
		'FILE "album.wav" WAVE\n TRACK 01 AUDIO\n TITLE "Ten minute cue"\n INDEX 01 10:00:00\n',
	], 'album.cue'), 'markers');
	controller.actions.transport.seek(600 * 48_000);
	assert.equal(engine.getPositionFrames(), 600 * 48_000, 'the visible marker must not seek back to the old thirty-second horizon');
	assert.equal(projectDurationFrames(controller.project), 0, 'annotation seeking does not lengthen rendered media');
});
