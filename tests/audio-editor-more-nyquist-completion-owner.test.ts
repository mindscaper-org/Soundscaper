/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deferred } from './helpers/async-test-control.ts';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createAudioEditorController, createCurrentAudioEditorProject, createMemoryEngine,
	createFixture, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';

test('an old Nyquist audio read cannot keep a new project busy or unlock its newer evaluation', async () => {
	const input = new Float32Array(80);
	const fixture = await createFixture('nyquist-completion-owner', { sampleRate: 8_000,
		tracks: [{ id: 'voice', name: 'Voice', input }] });
	const next = createCurrentAudioEditorProject({ id: 'nyquist-next', title: 'Next', sampleRate: 8_000,
		sources: fixture.project.sources, tracks: fixture.project.tracks, clips: fixture.project.clips });
	await fixture.store.saveProject(next);
	const first = deferred<void>(), second = deferred<void>();
	const firstEntered = deferred<void>(), secondEntered = deferred<void>();
	const runtime = await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	let renders = 0, evaluations = 0;
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const options = { headless: true, copy: ENGLISH_COPY, locale: 'en',
		store: fixture.store, engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: { dispose() {} } as unknown as Options['ffmpeg'],
		nyquistEvaluator: async (request: Parameters<typeof runtime.evaluate>[0]) => { evaluations++; return runtime.evaluate(request); },
		renderSnapshot: async () => {
			renders++;
			if (renders === 1) { firstEntered.resolve(); await first.promise; }
			else { secondEntered.resolve(); await second.promise; }
			return { length: input.length, sampleRate: 8_000, numberOfChannels: 1, getChannelData: () => input };
		},
	};
	const controller = createAudioEditorController(null, options);
	await controller.ready;
	const select = () => {
		controller.actions.timeline.selectTrack('voice');
		controller.actions.timeline.setSelection(0, input.length, { trackIds: ['voice'], clipIds: [] });
	};
	try {
		select();
		const oldRun = controller.actions.nyquist.evaluate({ source: '1', role: 'prompt' });
		await firstEntered.promise;
		await controller.actions.project.openById(next.id);
		assert.equal(controller.project?.id, next.id);
		assert.equal(controller.getSnapshot().processingEffect, false);
		select();
		const newRun = controller.actions.nyquist.evaluate({ source: '2', role: 'prompt' });
		await secondEntered.promise;
		assert.equal(controller.getSnapshot().processingEffect, true);
		const currentStatus = controller.getSnapshot().status;
		first.resolve(); await oldRun;
		assert.equal(controller.getSnapshot().processingEffect, true);
		assert.equal(controller.getSnapshot().nyquist.processing, true);
		assert.deepEqual(controller.getSnapshot().status, currentStatus);
		second.resolve(); await newRun;
		assert.equal(controller.getSnapshot().processingEffect, false);
		assert.equal(evaluations, 1, 'the cancelled old read must never reach the real interpreter');
	} finally {
		first.resolve(); second.resolve();
		await controller.dispose();
	}
});
