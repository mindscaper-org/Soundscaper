/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';

for (const [requested, supported] of [[.01, .5], [3, 2]] as const) {
	test(`choosing Preserve pitch reconciles the existing ${requested}× playback rate before starting`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const engine = createMemoryEngine();
		const playedRates: number[] = [];
		engine.playAtSpeed = async (rate: number) => { playedRates.push(rate); engine.state = 'playing'; };
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			store: createMemoryStore() as unknown as Options['store'], engine: engine as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		controller.actions.transport.setPlayAtSpeedRate(requested);
		await controller.actions.preferences.update({ playback: { playAtSpeedMode: 'staffpad' } });
		assert.equal(controller.getSnapshot().playbackOptions.rate, supported);
		await controller.actions.transport.playAtSpeed();
		assert.equal(playedRates.at(-1), supported);
		await controller.actions.transport.stop();
		controller.actions.transport.setPlayAtSpeedRate(requested);
		assert.equal(controller.getSnapshot().playbackOptions.rate, supported, 'every rate control obeys the selected processor range');
		await controller.actions.preferences.update({ playback: { playAtSpeedMode: 'naive' } });
		controller.actions.transport.setPlayAtSpeedRate(requested);
		assert.equal(controller.getSnapshot().playbackOptions.rate, requested, 'ordinary resampling retains the complete supported range');
	});
}
