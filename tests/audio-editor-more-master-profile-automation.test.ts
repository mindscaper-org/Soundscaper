/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import type { EffectAudioProject } from '../src/common/editor/controller/effects/internal/effect-audio-service-types.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { MockGainRenderingOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

for (const suffix of [false, true]) test(`Master Get Noise Profile ignores listening automation and ${suffix ? 'a later detector effect' : 'the master fader'}`, async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const source = createAudioSource({ id: 'source', frameCount: 4096, channelCount: 1, sampleRate: 48_000 });
	const project = createSoundscaperProject({ id: 'master-profile-automation', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4096, sourceDurationFrames: 4096 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	const store = createMemoryStore();
	store.audioSources.set(source.id, [Float32Array.from({ length: 4096 }, (_, frame) => 0.25 * Math.sin(frame / 8))]);
	const snapshots: unknown[] = [];
	const factory: NonNullable<Options['engineFactory']> = options => {
		const engine = createAudioEditorEngine({ ...options, audioContextFactory: null,
			offlineAudioContextFactory: settings => new MockGainRenderingOfflineAudioContext(settings) as unknown as OfflineAudioContext });
		const load = engine.loadProject.bind(engine);
		return Object.assign(engine, { loadProject(...args: Parameters<typeof load>) { snapshots.push(args[0]); return load(...args); } });
	};
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: factory });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
	const reduction = controller.actions.effects.add({ type: 'audacity-noise-reduction', scope: 'master' });
	assert.ok(reduction);
	if (suffix) assert.ok(controller.actions.effects.add({ type: 'audacity-auto-duck', scope: 'master',
		options: { context: { controlTrackId: 'track' } } }));
	const lane = normalizeAutomationLaneV21({ id: 'silent-master',
		address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' }, timebase: 'absolute-samples',
		points: [{ id: 'silent', position: 0, value: 0 }], segments: [] });
	controller.actions.edit.commit({ type: 'automation-lane/set', laneId: lane.id, expected: null, lane: { ...lane } });
	controller.actions.timeline.setSelection(0, 4096);
	await controller.actions.effects.captureRackNoiseProfile('master', null, reduction);
	const updated = controller.project as unknown as EffectAudioProject;
	const effect = updated.master.effects.find(candidate => candidate.id === reduction);
	const profile = effect?.context?.noiseProfile as { meanPowers?: readonly number[] } | undefined;
	assert.ok(profile?.meanPowers?.some(value => value > 0), 'the master listening automation must not turn the learned profile into silence');
	assert.deepEqual((snapshots.at(-1) as EffectAudioProject).automationLanes, []);
	assert.equal(normalizeMixerGraphV21((snapshots.at(-1) as EffectAudioProject).mixer).edges.some(edge => edge.kind === 'sidechain'), false);
	assert.deepEqual(controller.project!.automationLanes, [lane], 'authored listening automation remains untouched');
});
