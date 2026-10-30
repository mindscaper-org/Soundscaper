/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { loadAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { matchAudioEditorShortcut, resolveAudioEditorShortcutHandler } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

async function fixture(context: TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: engine as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: .4, channelCount: 1,
		durationSeconds: 1, frequency: 440 });
	const runtime = createAudacityActionRuntime(controller);
	context.after(() => { runtime.dispose(); });
	const track = controller.getSnapshot().project?.tracks?.[0];
	assert.ok(track);
	const trackId = track.id;
	function select(startFrame: number, endFrame = startFrame) {
		controller.actions.timeline.setExactSelection(startFrame, endFrame, { trackIds: [trackId] });
	}
	function selection() {
		const value = controller.getSnapshot().project?.selection;
		assert.ok(value);
		return value;
	}
	function range() {
		const { startFrame, endFrame } = selection();
		return [startFrame, endFrame];
	}
	async function press(key: '[' | ']') {
		const shortcuts = loadAudioEditorPreferencesV1(controller.getSnapshot().preferences).preferences.shortcuts;
		const actionId = matchAudioEditorShortcut({ key, code: key === '[' ? 'BracketLeft' : 'BracketRight',
			altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, shortcuts);
		assert.ok(actionId);
		const handler = resolveAudioEditorShortcutHandler(actionId, { actionRuntime: runtime.actions });
		assert.ok(handler, `${key} is enabled and has a concrete handler`);
		const position = engine.positionFrame;
		const transport = engine.state;
		await handler();
		assert.equal(engine.positionFrame, position, 'marking a boundary leaves playback in place');
		assert.equal(engine.state, transport, 'marking a boundary leaves transport running or paused');
	}
	return { controller, engine, trackId, select, selection, range, press };
}

for (const state of ['playing', 'paused']) {
	test(`[ then ] captures an exact selection during ${state}`, async context => {
		const { controller, engine, trackId, select, selection, range, press } = await fixture(context);
		select(0);
		controller.actions.timeline.setSnap({ enabled: true, unit: 'seconds', mode: 'nearest' });
		engine.state = state;
		engine.positionFrame = 9_601;
		await press('[');
		assert.deepEqual(range(), [9_601, 9_601]);
		engine.positionFrame = 24_013;
		await press(']');
		assert.deepEqual(range(), [9_601, 24_013]);
		assert.deepEqual(selection().trackIds, [trackId]);
	});

	test(`] extends from an existing point cursor during ${state}`, async context => {
		const { engine, select, range, press } = await fixture(context);
		select(9_600);
		engine.state = state;
		engine.positionFrame = 24_000;
		await press(']');
		assert.deepEqual(range(), [9_600, 24_000]);
	});

	for (const key of ['[', ']'] as const) {
		test(`${key} preserves the opposite endpoint of a range during ${state}`, async context => {
			const { controller, engine, trackId, selection, range, press } = await fixture(context);
			const frequencyRange = { minimumFrequency: 100, maximumFrequency: 1_000 };
			controller.actions.timeline.setExactSelection(4_801, 38_403, { trackIds: [trackId], frequencyRange });
			controller.actions.timeline.setSnap({ enabled: true, unit: 'seconds', mode: 'nearest' });
			engine.state = state;
			engine.positionFrame = 19_202;
			await press(key);
			assert.deepEqual(range(), key === '[' ? [19_202, 38_403] : [4_801, 19_202]);
			assert.deepEqual(selection().frequencyRange, frequencyRange);
		});

		test(`${key} collapses a range when it crosses the opposite boundary during ${state}`, async context => {
			const { engine, select, range, press } = await fixture(context);
			select(9_600, 24_000);
			engine.state = state;
			engine.positionFrame = key === '[' ? 38_400 : 4_800;
			await press(key);
			assert.deepEqual(range(), [engine.positionFrame, engine.positionFrame]);
		});
	}
}
