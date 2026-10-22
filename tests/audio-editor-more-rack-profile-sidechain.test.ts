/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EffectAudioProject } from '../src/common/editor/controller/effects/internal/effect-audio-service-types.ts';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { MockAudioWorkletNode, MockOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

for (const detector of ['track', 'bus'] as const) test(`Get Noise Profile retains the preceding Auto Duck ${detector} detector without profiling its listening fader`, async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const previous = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode as unknown as typeof AudioWorkletNode;
	context.after(() => { globalThis.AudioWorkletNode = previous; });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const source = createAudioSource({ id: 'source', frameCount: 4096, channelCount: 2, sampleRate: 48_000 });
	const project = createSoundscaperProject({ id: 'rack-profile-sidechain', sources: [source],
		clips: ['programme', 'control'].map(id => createAudioClip({ id: `${id}-clip`, sourceId: source.id,
			durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })),
		tracks: ['programme', 'control'].map(id => createAudioTrack({ id, gain: 0.25, pan: 0.5,
			clipIds: [`${id}-clip`] })) });
	const store = createMemoryStore();
	store.audioSources.set(source.id, [new Float32Array(4096).fill(0.5), new Float32Array(4096).fill(0.25)]);
	const snapshots: unknown[] = [];
	const renderModes: string[] = [];
	const factory: NonNullable<Options['engineFactory']> = options => {
		const engine = createAudioEditorEngine({ ...options, audioContextFactory: null,
			offlineAudioContextFactory: settings => new MockOfflineAudioContext(settings) as unknown as OfflineAudioContext });
		const load = engine.loadProject.bind(engine);
		const track = engine.renderTrack.bind(engine);
		const mix = engine.renderMix.bind(engine);
		return Object.assign(engine, {
			loadProject(...args: Parameters<typeof load>) { snapshots.push(args[0]); return load(...args); },
			renderTrack(...args: Parameters<typeof track>) { renderModes.push('track'); return track(...args); },
			renderMix(...args: Parameters<typeof mix>) { renderModes.push('mix'); return mix(...args); },
		});
	};
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: factory });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
	const duck = controller.actions.effects.add({ type: 'audacity-auto-duck', scope: 'track', trackId: 'programme',
		options: { context: { controlTrackId: 'control' } } });
	const reduction = controller.actions.effects.add({ type: 'audacity-noise-reduction', scope: 'track', trackId: 'programme' });
	assert.ok(duck); assert.ok(reduction);
	if (detector === 'bus') {
		controller.actions.mixer.addBus('group', { id: 'detector-bus', name: 'Detector bus' });
		const graph = normalizeMixerGraphV21(controller.project!.mixer);
		controller.actions.edit.commit({ type: 'mixer-graph/set', expected: { ...graph }, mixer: { ...graph,
			edges: [...graph.edges.map(edge => edge.kind === 'sidechain'
				? { ...edge, source: { kind: 'mixer-node', id: 'detector-bus' } } : edge),
				{ id: 'detector-input', kind: 'send', source: { kind: 'track', id: 'control' },
					destination: { kind: 'mixer-node', id: 'detector-bus' }, position: 'post-fader', level: 0.5,
					enabled: true, channelMap: [0, 1] }] } });
	}
	controller.actions.timeline.setSelection(0, 4096);
	await controller.actions.effects.captureRackNoiseProfile('track', 'programme', reduction);
	const capture = snapshots.at(-1) as EffectAudioProject;
	assert.deepEqual(capture.tracks.map(track => track.id), ['programme', 'control']);
	assert.deepEqual(capture.tracks[0]!.effects!.map(effect => effect.id), [duck]);
	assert.equal(capture.tracks[0]!.gain, 1);
	assert.equal(capture.tracks[0]!.pan, 0);
	assert.equal(capture.tracks[1]!.gain, 0.25);
	assert.equal(normalizeMixerGraphV21(capture.mixer).edges.filter(edge => edge.kind === 'sidechain').length, 1);
	if (detector === 'bus') {
		assert.equal(normalizeMixerGraphV21(capture.mixer).groups[0]!.id, 'detector-bus');
		assert.ok(normalizeMixerGraphV21(capture.mixer).edges.some(edge => edge.id === 'detector-input'));
	}
	assert.deepEqual(renderModes, ['mix'], 'detector inputs need the closed graph render, including transitive bus inputs');
	const updated = controller.project as unknown as EffectAudioProject;
	const effect = updated.tracks[0]!.effects!.find(candidate => candidate.id === reduction);
	assert.equal(effect?.enabled, true);
	assert.ok(effect?.context?.noiseProfile);
});
