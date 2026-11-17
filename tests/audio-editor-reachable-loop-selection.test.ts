/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';

async function fixture(context: TestContext) {
	const audio = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => audio as unknown as EngineAudioContext });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY, engine, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { frequency: 440, durationSeconds: 1, channelCount: 1 });
	return { controller, engine };
}

test('Play Selection auditions the drawn range once even with a different stored loop', async context => {
	const { controller, engine } = await fixture(context);
	controller.actions.transport.setLoopRegion(24_000, 36_000);
	controller.actions.timeline.setExactSelection(4_800, 14_400);
	await controller.actions.transport.playSelection();
	const playback = engine.getState();
	assert.equal(playback.playbackStartFrame, 4_800);
	assert.equal(playback.playbackEndFrame, 14_400);
	assert.equal(playback.loop?.enabled, false);
	assert.deepEqual(controller.project?.loop, { enabled: true, startFrame: 24_000, endFrame: 36_000 });
	await controller.actions.transport.stop();
	await controller.actions.transport.playPause();
	assert.equal(engine.getState().playbackEndFrame, 36_000);
	assert.equal(engine.getState().loop?.enabled, true);
});

test('Set Selection to Loop Region keeps the chosen audio tracks', async context => {
	const { controller } = await fixture(context);
	const first = controller.getSnapshot().selectedTrackId;
	assert.ok(first);
	await controller.actions.generators.generate('tone', { frequency: 660, durationSeconds: 1, channelCount: 1, atFrame: 0 });
	const second = controller.getSnapshot().selectedTrackId;
	assert.ok(second && second !== first);
	const trackIds = [first, second];
	controller.actions.transport.setLoopRegion(24_000, 36_000);
	controller.actions.timeline.setExactSelection(4_800, 14_400, { trackIds });
	controller.actions.transport.selectionToLoop();
	const selection = controller.project?.selection;
	assert.deepEqual([selection?.startFrame, selection?.endFrame], [24_000, 36_000]);
	assert.deepEqual(selection?.trackIds, trackIds);
	controller.actions.edit.deleteLeaveGap();
	assert.equal(controller.project?.tracks.filter(track => Array.isArray(track.clipIds) && track.clipIds.length === 2).length, 2);
});
