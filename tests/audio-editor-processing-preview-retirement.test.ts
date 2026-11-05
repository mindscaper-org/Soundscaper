/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { evaluateNyquist, loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createAudioEditorController, createTwoTrackFixture, ENGLISH_COPY } from './helpers/audio-editor-multitrack-selection-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockGainRenderingOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

const nyquist = loadNyquistWasm(await readFile(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));

for (const kind of ['selection', 'nyquist'] as const) {
	for (const prior of ['none', 'timeline', 'source', 'bin'] as const) {
		test(`${kind} processing Preview retires the prior ${prior} audio owner`, async context => {
			const rate = 8000, input = new Float32Array(rate * 6).fill(.25);
			const { store } = await createTwoTrackFixture(`processing-preview-${kind}-${prior}`, new Map([['main', input], ['other', input]]), rate);
			const contexts: MockAudioContext[] = [];
			const factory: typeof createAudioEditorEngine = (options = {}) => createAudioEditorEngine({ ...options,
				audioContextFactory: settings => { const audio = new MockAudioContext(settings); contexts.push(audio); return audio as unknown as AudioContext; },
				offlineAudioContextFactory: settings => new MockGainRenderingOfflineAudioContext(settings) as unknown as OfflineAudioContext,
			});
			const engine = factory();
			const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: ENGLISH_COPY,
				store, engine, engineFactory: factory,
				nyquistEvaluator: async (request: Parameters<typeof evaluateNyquist>[0]) => evaluateNyquist(request, await nyquist),
			});
			context.after(async () => { await controller.dispose(); });
			await controller.ready;
			controller.actions.projectBin.moveFromTimeline('other-clip');
			controller.actions.timeline.selectClip('main-clip');
			controller.actions.timeline.setSelection(0, rate, { trackIds: ['main'], clipIds: [] });
			if (prior === 'bin') await controller.actions.projectBin.playPause('other-clip');
			else if (prior === 'source') await controller.actions.clipSourcePreview.playPause('main-clip');
			else if (prior === 'timeline') await controller.actions.transport.playPause();
			if (kind === 'selection') assert.equal(await controller.actions.effects.previewSelection({ type: 'audacity-amplify', params: { gainDb: 0, allowClipping: true } }), true);
			else await controller.actions.nyquist.preview({ source: '*track*', role: 'process' });
			assert.notEqual(engine.getState().state, 'playing', 'the timeline must yield to the processing audition');
			assert.notEqual(controller.actions.clipSourcePreview.snapshot().state, 'playing', 'Source audio must yield to the processing audition');
			assert.equal(controller.getSnapshot().projectBinPreview, null, 'Bin audio must yield to the processing audition');
			const sounding = contexts.flatMap(audio => audio.bufferSources).filter(source => Reflect.has(source, 'started') && !Reflect.get(source, 'stopped'));
			assert.equal(sounding.length, 1, 'only the requested processing result may remain scheduled');
			const buffer: unknown = Reflect.get(sounding[0] ?? {}, 'buffer');
			assert.ok(buffer instanceof MockAudioBuffer);
			assert.ok(buffer.getChannelData(0).some(value => Math.abs(value) > .1), 'the requested result remains audible');
		});
	}
}
