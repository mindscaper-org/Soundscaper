/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createEffect, projectEffectTailFrames } from '../src/common/editor/effects.js';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createCurrentAudioEditorProject, loadCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { buildProjectGraph, projectGraphLatencyFrames } from '../src/common/editor/engine/project-graph.ts';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
import { projectEffectRacks } from '../src/common/editor/engine/project-effects.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { asBaselineSoundscaperProject, importBaselineScapeProject } from './helpers/baseline-scape-runtime.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { clipEffectControlTrackIds } from '../src/common/editor/clip-effect-control-tracks.ts';
import { compileParallelStackPlan } from '../src/common/editor/engine/parallel-stack-plan.ts';
import { compileProjectPathPdcPlanV21 } from '../src/common/editor/engine/project-path-pdc-plan-v21.ts';
import { engineNativeEffectPdcControlMethods } from '../src/common/editor/engine/native-effect-pdc-control.ts';

function project() {
	return createCurrentAudioEditorProject({
		sampleRate: 48_000,
		sources: [{ id: 'source', name: 'Impulse', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 2400 }],
		clips: ['first', 'second'].map((id, index) => ({ id, sourceId: 'source', durationFrames: 2400, sourceDurationFrames: 2400, timelineStartFrame: index * 2880 })),
		tracks: [{ id: 'track', name: 'Track', clipIds: ['first', 'second'] }],
	});
}

test('clip racks retain external controls and force conventional graph admission', () => {
	const document = projectForRuntimeConsumers(project()) as EngineProject;
	const processed = { ...document, schemaFamily: 'soundscaper', schemaVersion: 1,
		clips: [{ ...document.clips![0]!, effects: [
			{ id: 'pitch', type: 'auto-tune', params: { controlTrackId: 'midi' } },
			{ id: 'duck', type: 'audacity-auto-duck', context: { controlTrackId: 'detector' } },
			{ id: 'disabled', type: 'auto-tune', enabled: false, params: { controlTrackId: 'ignored' } },
		] }] };
	assert.deepEqual(clipEffectControlTrackIds(processed, new Set(['track'])), ['midi', 'detector']);
	assert.deepEqual(clipEffectControlTrackIds(processed, new Set(['other'])), []);
	assert.throws(() => compileParallelStackPlan(processed, { sampleRate: 48_000, workerCount: 2 }), /clip effect racks/u);
});

test('a live mixer compensation revision accounts for latency already applied by the clip rack', () => {
	const runtime = projectForRuntimeConsumers(applyEditorCommand(project(), { type: 'effect/add', scope: 'clip', trackId: 'first',
		effect: createEffect('compressor', { id: 'compressor' }) })) as EngineProject;
	const production = { ...runtime, mixer: createDefaultMixerGraphV21([{ id: 'track', channelCount: 1 }], 2), automationLanes: [] };
	const plan = compileProjectPathPdcPlanV21(production);
	const values: number[] = [];
	engineNativeEffectPdcControlMethods.commitNativeEffectPdcRevision.call({
		project: production, context: { currentTime: 0 }, sampleRate: 48_000, playbackRate: 1, state: 'playing', getPositionFrames: () => 0,
		graph: { pathPdcDelayParamsV21: new Map([['input:track:track', { setValueAtTime: (value: number) => { values.push(value); } }]]) },
	} as never, { atFrame: 128, blockFrames: 128, pdcErrorSamples: 0, plan });
	assert.deepEqual(values, [0], 'the mixer must not add the clip latency for a second time');
});

test('clip racks edit, reorder, bypass, remove and reopen independently of track effects', () => {
	let document = project();
	const delay = createEffect('delay', { id: 'clip-delay', params: { time: 0.01, feedback: 0, mix: 1 } });
	document = applyEditorCommand(document, { type: 'effect/add', scope: 'clip', trackId: 'first', effect: delay });
	document = applyEditorCommand(document, { type: 'effect/add', scope: 'clip', trackId: 'first', effect: createEffect('highpass', { id: 'clip-filter' }) });
	document = applyEditorCommand(document, { type: 'effect/reorder', scope: 'clip', trackId: 'first', effectId: 'clip-filter', toIndex: 0 });
	document = applyEditorCommand(document, { type: 'effect/update', scope: 'clip', trackId: 'first', effectId: 'clip-delay', changes: { enabled: false } });
	const reopened = loadCurrentAudioEditorProject(JSON.parse(JSON.stringify(document))).project;
	const runtime = projectForRuntimeConsumers(reopened) as EngineProject;
	assert.deepEqual(runtime.clips?.[0]?.effects?.map(effect => [effect.id, effect.enabled]), [['clip-filter', true], ['clip-delay', false]]);
	assert.deepEqual(runtime.clips?.[1]?.effects ?? [], []);
	assert.deepEqual(runtime.tracks?.[0]?.effects, []);
	assert.ok([...projectEffectRacks(runtime)].some(rack => rack.scope === 'clip' && rack.targetId === 'first'));
	document = applyEditorCommand(document, { type: 'effect/remove', scope: 'clip', trackId: 'first', effectId: 'clip-filter' });
	assert.equal((projectForRuntimeConsumers(document) as EngineProject).clips?.[0]?.effects?.length, 1);
	assert.throws(() => applyEditorCommand(document, { type: 'effect/add', scope: 'clip', trackId: 'missing', effect: delay }));
	const locked = applyEditorCommand(document, { type: 'track/update', trackId: 'track', changes: { locked: true } });
	assert.throws(() => applyEditorCommand(locked, { type: 'effect/remove', scope: 'clip', trackId: 'first', effectId: 'clip-delay' }), /locked/u);
});

test('portable Scape roundtrip retains clip rack order, parameters and bypass', async context => {
	let document = applyEditorCommand(project(), { type: 'effect/add', scope: 'clip', trackId: 'first',
		effect: createEffect('delay', { id: 'clip-delay', params: { time: 0.125, feedback: 0.3, mix: 0.7 } }) });
	document = applyEditorCommand(document, { type: 'clip/update', clipId: 'first', changes: { effectsActive: false } });
	const sender = createMemoryProjectStore(context, 'clip-fx-sender');
	const recipient = createMemoryProjectStore(context, 'clip-fx-recipient');
	const writer = await sender.beginSourceWrite('source', { name: 'Impulse', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1 });
	await writer.write([new Float32Array(2400)]);
	await writer.commit();
	const exported = await exportScapeProject(asBaselineSoundscaperProject(document), sender);
	const imported = await importBaselineScapeProject(exported.blob, recipient);
	const runtime = projectForRuntimeConsumers(imported.project) as EngineProject;
	assert.equal(runtime.clips?.[0]?.effectsActive, false);
	assert.deepEqual(runtime.clips?.[0]?.effects?.map(effect => [effect.type, effect.params]),
		[['delay', { time: 0.125, feedback: 0.3, mix: 0.7 }]]);
	assert.deepEqual(runtime.clips?.[1]?.effects ?? [], []);
});

for (const type of ['delay', 'compressor'] as const) for (const graph of ['legacy', 'v21'] as const) test(`${graph}: clip ${type} preserves isolation, latency and tails`, async () => {
	const document = applyEditorCommand(project(), { type: 'effect/add', scope: 'clip', trackId: 'first',
		effect: createEffect(type, { id: 'clip-effect', params: type === 'delay' ? { time: 0.01, feedback: 0, mix: 1 } : { threshold: 0, ratio: 1, knee: 0 } }) });
	const projected = projectForRuntimeConsumers(document) as EngineProject;
	const runtime = graph === 'v21' ? { ...projected, mixer: createDefaultMixerGraphV21([{ id: 'track', channelCount: 1 }], 2), automationLanes: [] } : projected;
	const context = new OfflineAudioContext(2, 7200, 48_000);
	const source = context.createBuffer(1, 2400, 48_000);
	source.getChannelData(0)[0] = 0.5;
	const compiled = buildProjectGraph(context as unknown as BaseAudioContext, context.destination as unknown as AudioNode, runtime, { metering: false, graph, includeTrackPan: false });
	await scheduleProjectClips({ context: context as unknown as BaseAudioContext, project: runtime,
		sources: new Map([['source', source as unknown as AudioBuffer]]), trackInputs: compiled.trackInputs,
		fromFrame: 0, toFrame: 7200, contextStartTime: 0, sampleRate: 48_000, reversedBuffers: new WeakMap(),
		sourceResolver: null, activeSources: compiled.sources, allNodes: compiled.nodes, mode: 'offline' });
	const rendered = await context.startRendering();
	const samples = rendered.getChannelData(0);
	assert.ok(Math.abs(samples[0]!) < 1e-6, 'the wet clip must not also play dry');
	// node-web-audio-api uses a 384-frame compressor ring; the browser graph's
	// existing 288-frame compensation contract is checked separately below.
	assert.ok(Math.abs(samples[type === 'delay' ? 480 : 384]! - 0.5) < (type === 'delay' ? 1e-5 : 0.005), 'clip processor must process the first clip');
	assert.ok(Math.abs(samples[2880 + compiled.latencyFrames]! - 0.5) < 1e-5, 'the next clip must remain dry and aligned');
	assert.equal(projectGraphLatencyFrames(runtime, { graph }), compiled.latencyFrames);
	assert.equal(compiled.latencyFrames, type === 'delay' ? 0 : 288);
	assert.equal(projectEffectTailFrames(runtime), type === 'delay' ? 480 : 0);
});
