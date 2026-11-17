/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { planFreezeRange, renderFreezeBody } from '../src/soundscaper/editor-audio-track-freeze-render.ts';

for (const trackBypassed of [false, true]) test(`freeze preserves clip echo tails when the track rack is ${trackBypassed ? 'bypassed' : 'active'}`, async context => {
	const store = createMemoryProjectStore(context, 'freeze-clip-tail'), factory = createNodeWebAudioEngineFactory(context);
	const input = new Float32Array(4800); input[4799] = .5;
	const writer = await store.beginSourceWrite('source', { sampleRate: 48000, channelCount: 1, chunkFrames: 65536 });
	await writer.write([input]); await writer.commit();
	const project = createSoundscaperProject({ sampleRate: 48000,
		sources: [{ id: 'source', storageKey: 'source', frameCount: 4800, sampleRate: 48000, channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4800, effects: [createEffect('delay', { params: { time: .05, feedback: 0, mix: 1 } })] }],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'], effectsActive: !trackBypassed,
			effects: [createEffect('delay', { params: { time: .025, feedback: 0, mix: 1 } })] }],
	});
	const range = planFreezeRange(project, 'voice');
	const rendered = await renderFreezeBody(store, { project }, () => factory.createEngine(), { project, trackId: 'voice', sampleRate: 48000, ...range });
	assert.ok(rendered.body.channels[0]!.some((value, frame) => frame >= (trackBypassed ? 4800 : 7200) && Math.abs(value) > .1), 'the frozen PCM must contain the echo after the editable clip ends');
});
