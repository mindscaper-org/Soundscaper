/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { MockGainRenderingOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

for (const scope of ['master', 'group', 'send'] as const) for (const upstreamMuted of [false, true]) for (const listening of ['vca', 'output'] as const) {
	test(`${scope} Get Noise Profile excludes master ${listening} but preserves upstream mute=${upstreamMuted}`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const source = createAudioSource({ id: 'tone', frameCount: 4096, sampleRate: 48_000, channelCount: 2 });
		const project = createSoundscaperProject({ id: `profile-listening-${scope}-${upstreamMuted}`, sources: [source],
			tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })] });
		const store = createMemoryStore();
		store.audioSources.set(source.id, [Float32Array.from({ length: 4096 }, (_, frame) => .25 * Math.sin(frame / 8)), new Float32Array(4096)]);
		const captured: Parameters<ReturnType<typeof createAudioEditorEngine>['loadProject']>[0][] = [];
		const factory: NonNullable<Options['engineFactory']> = options => {
			const engine = createAudioEditorEngine({ ...options, audioContextFactory: null,
				offlineAudioContextFactory: settings => new MockGainRenderingOfflineAudioContext(settings) as unknown as OfflineAudioContext });
			const load = engine.loadProject.bind(engine);
			return Object.assign(engine, { loadProject(...args: Parameters<typeof load>) { captured.push(args[0]); return load(...args); } });
		};
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), engineFactory: factory,
			store: store as unknown as Options['store'], engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
		const target = scope === 'master' ? null : String(controller.actions.mixer.addBus(scope, { id: 'bus', name: 'Profile bus' }));
		const effectId = controller.actions.effects.add({ type: 'audacity-noise-reduction', scope, trackId: target });
		assert.ok(effectId);
		const graph = normalizeMixerGraphV21(controller.project!.mixer);
		const vcas = [{ id: 'master-vca', name: 'Listening VCA', gain: listening === 'vca' ? .25 : 1, mute: listening === 'vca', members: [{ kind: 'master' as const }] },
			{ id: 'programme-vca', name: 'Programme VCA', gain: .5, mute: upstreamMuted, members: [{ kind: 'track' as const, id: 'track' }] }];
		controller.actions.edit.commit({ type: 'mixer-graph/set', expected: { ...graph }, mixer: { ...graph, vcas,
			edges: [...graph.edges.map(edge => listening === 'output' && edge.source.kind === 'master' && edge.destination.kind === 'output' ? { ...edge, level: 0 } : edge), ...(target ? [{ id: 'profile-feed', kind: 'send', source: { kind: 'track', id: 'track' },
				destination: { kind: 'mixer-node', id: target }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }] : [])] } });
		controller.actions.mixer.updateMaster({ pan: .75 });
		controller.actions.timeline.setSelection(0, 4096);
		await controller.actions.effects.captureRackNoiseProfile(scope, target, effectId);
		const updated = controller.project;
		assert.ok(validateSoundscaperProject(updated));
		const effects = scope === 'master' ? updated.master.effects : normalizeMixerGraphV21(updated.mixer)[scope === 'group' ? 'groups' : 'sends'][0]!.effects;
		const effect = effects.find(candidate => candidate.id === effectId);
		assert.ok(effect);
		const profile = (effect.context as Readonly<{ noiseProfile: Readonly<{ meanPowers: readonly number[] }> }>).noiseProfile;
		assert.equal(profile.meanPowers.some(power => power > 0), !upstreamMuted, 'only upstream programme mute may silence the rack input');
		assert.equal(captured.at(-1)?.master?.pan, 0, 'the profile tap precedes the master listening panner');
		assert.deepEqual(updated.mixer.vcas, vcas, 'private capture never edits the authored VCA graph');
		assert.equal(updated.master.pan, .75);
	});
}
