/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip } from '../src/common/editor/project-media-factory.ts';
import { createEnvelopeValueEvaluator } from '../src/common/editor/automation.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

for (const extent of ['beat', 'fixedSamples'] as const) test(`microphone bleed edits beat-anchored ${extent} audio using its current sample clock`, async context => {
	const native = createNodeWebAudioEngineFactory(context);
	const { controller, store } = await controllerSession(context, { engine: native.createEngine(), engineFactory: native.createEngine });
	const frames = 32000, rate = 8000;
	let state = 29, smooth = 0;
	const voice = Float32Array.from({ length: frames }, () => {
		state = Math.imul(state, 1664525) + 1013904223 | 0;
		smooth = .85 * smooth + .15 * state / 2 ** 31; return smooth;
	});
	for (const [index, gain] of [1, .2].entries()) {
		const writer = await store.beginSourceWrite(`source-${String(index)}`, { sampleRate: rate, channelCount: 1 });
		await writer.write([Float32Array.from(voice, sample => sample * gain)]); await writer.commit();
	}
	const project = createSoundscaperProject({ id: 'beat-microphones', sampleRate: rate,
		sources: [0, 1].map(index => ({ id: `source-${String(index)}`, storageKey: `source-${String(index)}`, sampleRate: rate, frameCount: frames, channelCount: 1 })),
		clips: [0, 1].map(index => createAudioClip({ id: `clip-${String(index)}`, sourceId: `source-${String(index)}`,
			anchor: 'musical', musicalStartBeat: 2, musicalExtent: extent, musicalDurationBeats: extent === 'beat' ? 8 : null,
			durationFrames: frames, sourceDurationFrames: frames })),
		tracks: [0, 1].map(index => ({ id: `track-${String(index)}`, type: 'audio', clipIds: [`clip-${String(index)}`] })),
	});
	await store.saveProject(project); await controller.actions.project.open(project);
	controller.actions.timeline.setExactSelection(rate, rate + frames, { trackIds: ['track-0', 'track-1'] });
	await assert.doesNotReject(controller.actions.effects.reduceMicrophoneBleed());
	const processed = controller.project;
	assert.ok(processed);
	const changed = processed.clips.find(clip => clip.id === 'clip-1'); assert.ok(changed?.kind === 'audio');
	assert.equal(changed.anchor, 'musical');
	const gain = createEnvelopeValueEvaluator(changed.envelope, frames);
	assert.ok(gain(16000) < .3, 'the weaker microphone receives the audible reduction');
});
