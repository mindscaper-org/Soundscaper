/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createController, createFixture } from './helpers/audio-editor-nyquist-controller-harness.js';

test('a failed Nyquist Prompt refuses the prior numeric result through the public controller', async () => {
	const input = new Float32Array(8_000);
	const projectStore = await createFixture('nyquist-error-results', { sampleRate: 8_000,
		tracks: [{ id: 'voice', name: 'Voice', input }] });
	const runtime = await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	const controller = createController(projectStore.store, new Map([['voice', input]]),
		(request: Parameters<typeof runtime.evaluate>[0]) => Promise.resolve(runtime.evaluate(request)));
	await controller.ready;
	try {
		controller.actions.timeline.selectTrack('voice');
		controller.actions.timeline.setSelection(0, input.length, { trackIds: ['voice'], clipIds: [] });
		await assert.rejects(controller.actions.nyquist.evaluate({ source: '42 (/ 1 0)', role: 'prompt' }),
		/division by zero/iu);
		assert.equal(controller.getSnapshot().nyquist.result, null);
	} finally { await controller.dispose(); }
});

test('Nyquist failures after successful top-level values never publish stale numbers or PCM', async () => {
	const runtime = await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	for (const source of ['42 (/ 1 0)', '42)', '(osc 60 0.1) (error "Failed after audio")']) {
		assert.throws(() => runtime.evaluate({ source, controls: { last: 7 } }), /division by zero|right paren|Failed after audio/iu);
	}
	const success = runtime.evaluate({ source: '(print "error: quoted text") 42', controls: { last: 7 } });
	assert.equal(success.type, 'number');
	assert.equal(success.value, 42);
});
