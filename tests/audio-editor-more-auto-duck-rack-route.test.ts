/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode } from './helpers/audio-editor-runtime-harness.js';

for (const scope of ['track', 'master', 'group', 'send'] as const) {
	test(`Add Auto Duck to a ${scope} rack retains its selected control route in production playback`, async (context) => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const previous = globalThis.AudioWorkletNode;
		globalThis.AudioWorkletNode = MockAudioWorkletNode as unknown as typeof AudioWorkletNode;
		context.after(() => { globalThis.AudioWorkletNode = previous; });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const source = createAudioSource({ id: 'source', frameCount: 4096, channelCount: 2, sampleRate: 48_000 });
		const project = createSoundscaperProject({ id: `auto-duck-${scope}`, sources: [source],
			clips: ['programme', 'control', 'alternate'].map(id => createAudioClip({ id: `${id}-clip`, sourceId: source.id,
				durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })),
			tracks: ['programme', 'control', 'alternate'].map(id => createAudioTrack({ id, clipIds: [`${id}-clip`] })) });
		const store = createMemoryStore();
		store.audioSources.set(source.id, [new Float32Array(4096).fill(0.5), new Float32Array(4096).fill(0.25)]);
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
		const targetId = scope === 'master' ? null : scope === 'track' ? 'programme'
			: String(controller.actions.mixer.addBus(scope, { id: `${scope}-bus`, name: 'Bus' }));
		const effectId = controller.actions.effects.add({ type: 'audacity-auto-duck', scope,
			trackId: targetId, options: { context: { controlTrackId: 'control' } } });
		assert.ok(effectId);
		const audio = new MockAudioContext();
		const engine = createAudioEditorEngine({ audioContextFactory: () => audio as unknown as EngineAudioContext });
		context.after(async () => { await engine.dispose(); });
		engine.loadProject(controller.project!, new Map([[source.id, new MockAudioBuffer(2, 4096, 48_000) as unknown as AudioBuffer]]));
		await engine.play();
		assert.equal(engine.getState().state, 'playing');
		const routes = () => normalizeMixerGraphV21(controller.project!.mixer).edges.filter(edge => edge.destination.kind === 'effect-sidechain');
		assert.equal(routes().length, 1);
		assert.deepEqual(routes()[0]!.source, { kind: 'track', id: 'control' });
		controller.actions.edit.undo();
		assert.deepEqual(routes(), [], 'Undo removes both the rack addition and its control route');
		controller.actions.edit.redo();
		assert.equal(routes().length, 1);
		const authored = normalizeMixerGraphV21(controller.project!.mixer);
		const custom = { ...authored, edges: authored.edges.map(edge => edge.id === routes()[0]!.id
			? { ...edge, level: 0.25, channelMap: [1, 0] } : edge) };
		controller.actions.edit.commit({ type: 'mixer-graph/set', expected: authored as unknown as Readonly<Record<string, unknown>>,
			mixer: custom as unknown as Readonly<Record<string, unknown>> });
		controller.actions.effects.setMasterGain(0.5);
		assert.deepEqual(routes()[0], custom.edges.find(edge => edge.id === routes()[0]!.id), 'unrelated edits preserve advanced control routing');
		controller.actions.effects.update(scope, targetId, effectId, { context: { controlTrackId: 'alternate' } });
		assert.deepEqual(routes()[0]!.source, { kind: 'track', id: 'alternate' });
		assert.equal(routes()[0]!.level, 0.25);
		assert.deepEqual(routes()[0]!.channelMap, [1, 0]);
		controller.actions.edit.undo();
		assert.deepEqual(routes()[0]!.source, { kind: 'track', id: 'control' });
		controller.actions.effects.copy(scope, targetId, effectId);
		assert.equal(routes().length, 2, 'copying the rack materializes the duplicate detector route');
		controller.actions.effects.copyStack(scope, targetId);
		controller.actions.effects.pasteStack(scope, targetId);
		assert.equal(routes().length, 2, 'paste replaces old routes and creates exactly the new rack routes');
		engine.stop(); engine.loadProject(controller.project!, new Map([[source.id, new MockAudioBuffer(2, 4096, 48_000) as unknown as AudioBuffer]]));
		await engine.play();
		assert.equal(engine.getState().state, 'playing');
	});
}
