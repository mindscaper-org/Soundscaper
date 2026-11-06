/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { COPY, createAudioEditorController, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { MidiPreviewContext } from './helpers/midi-preview-context.ts';
import { MockChunkStreamClient, MockNode, MockParam } from './helpers/mock-audio-context.js';
import { createMockAudioWorkletNodeClass } from './helpers/mock-audio-worklet-node.js';
import { settle } from './helpers/async-test-control.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { ScheduledParameterRegistry } from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';

class MixerParam extends MockParam {
	cancelScheduledValues(time: number): void {
		for (let index = this.events.length - 1; index >= 0; index--) {
			const event = this.events[index];
			if (event && typeof event[2] === 'number' && event[2] >= time) this.events.splice(index, 1);
		}
	}
}

class MixerContext extends MidiPreviewContext {
	readonly gains: (MockNode & { readonly gain: MixerParam })[] = [];
	createGain(): MockNode & { readonly gain: MixerParam } {
		const node = Object.assign(super.createGain(), { gain: new MixerParam(1) }); this.gains.push(node); return node;
	}
}

async function fixture(t: TestContext, channelCount = 1, native = true) {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: createMockAudioWorkletNodeClass(MockNode) });
	t.after(() => { if (previous) Object.defineProperty(globalThis, 'AudioWorkletNode', previous); else Reflect.deleteProperty(globalThis, 'AudioWorkletNode'); });
	const context = new MixerContext(), chunkStreamClient = new MockChunkStreamClient();
	let renderedGain: unknown;
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext,
		chunkStreamClient, offlineAudioContextFactory: null, softwareRenderer: options => {
			const project = options.project;
			assert.ok(project && typeof project === 'object' && 'master' in project);
			const master = project.master; assert.ok(master && typeof master === 'object' && 'gain' in master);
			renderedGain = master.gain;
			return { channels: [new Float32Array(48)], sampleRate: 48_000 };
		} });
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, engine,
		...(native ? { projectRuntime, sessionController: projectRuntime.createSessionController() } : {}),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: t.name }) });
	t.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: .25, channelCount, durationSeconds: 5, frequency: 440 });
	await settle(3);
	return { controller, engine, context, chunkStreamClient, canonicalGain: () => {
		const project = controller.getSnapshot().project; assert.ok(project);
		const master = project.master; assert.ok(master && typeof master === 'object' && 'gain' in master);
		assert.ok(typeof master.gain === 'number'); return master.gain;
	}, runtimeGain: async () => {
		await engine.renderMix({ startFrame: 0, endFrame: 48 }); return renderedGain;
	} };
}

const MASTER = { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' } as const;

test('a live fader commit retains the same active source and adopts its static engine value as one Undo', async t => {
	const f = await fixture(t); await f.controller.actions.transport.playPause();
	const beforeSources = f.context.bufferSources.length, beforeStreams = f.chunkStreamClient.opens.length;
	f.context.currentTime = .6;
	f.controller.actions.mixer.beginParameterGesture(MASTER);
	f.controller.actions.mixer.previewParameterGesture(MASTER, .6);
	f.controller.actions.mixer.commitParameterGesture(MASTER, .6);
	await settle(3);
	assert.equal(f.context.bufferSources.length, beforeSources, 'committing a live scalar must retain pending processor history');
	assert.equal(f.chunkStreamClient.opens.length, beforeStreams);
	assert.equal(f.canonicalGain(), .6);
	assert.equal(await f.runtimeGain(), .6, 'future renders must read the adopted static engine value');
	f.controller.actions.edit.undo(); await settle(3);
	assert.equal(f.canonicalGain(), 1);
	f.controller.actions.edit.redo(); await settle(3);
	assert.equal(f.canonicalGain(), .6);
});

test('a stopped fader commit still applies its value to the next playback graph', async t => {
	const f = await fixture(t);
	f.controller.actions.mixer.beginParameterGesture(MASTER);
	f.controller.actions.mixer.commitParameterGesture(MASTER, .4); await settle(3);
	assert.equal(await f.runtimeGain(), .4);
	await f.controller.actions.transport.playPause();
	assert.equal(f.engine.getState().state, 'playing');
	assert.equal(f.canonicalGain(), .4);
});

for (const scope of ['track', 'group', 'send', 'master-pan'] as const) test(`live ${scope} parameter adoption preserves the existing programme graph`, async t => {
	const f = await fixture(t, scope === 'master-pan' ? 2 : 1);
	const trackId = f.controller.getSnapshot().selectedTrackId; assert.ok(typeof trackId === 'string');
	let strip: { kind: 'track' | 'mixer-node'; id: string } | { kind: 'master' } = { kind: 'track', id: trackId };
	if (scope === 'master-pan') strip = { kind: 'master' };
	if (scope === 'group' || scope === 'send') {
		const id = f.controller.actions.mixer.addBus(scope); assert.ok(typeof id === 'string');
		strip = { kind: 'mixer-node', id };
		if (scope === 'group') f.controller.actions.mixer.setRoute(trackId, { groupId: id });
		else f.controller.actions.mixer.setSend(trackId, id, .5);
		await settle(3);
	}
	await f.controller.actions.transport.playPause();
	const sources = f.context.bufferSources.length;
	const before = structuredClone(f.controller.getSnapshot().project);
	const address = { kind: 'strip' as const, strip, parameterId: scope === 'master-pan' ? 'pan' as const : 'gain' as const };
	f.controller.actions.mixer.beginParameterGesture(address);
	f.controller.actions.mixer.previewParameterGesture(address, .5);
	assert.deepEqual(f.controller.getSnapshot().project, before, 'preview cannot mutate the persisted document');
	f.controller.actions.mixer.commitParameterGesture(address, .5); await settle(3);
	assert.equal(f.context.bufferSources.length, sources);
	assert.equal(f.engine.getState().state, 'playing');
});

test('a current live parameter failure leaves authored gain unchanged and reports the actual failure', async t => {
	const f = await fixture(t); await f.controller.actions.transport.playPause();
	f.engine.configureMixerParameter = () => { throw new Error('The live parameter target failed.'); };
	f.controller.actions.mixer.beginParameterGesture(MASTER);
	assert.throws(() => f.controller.actions.mixer.commitParameterGesture(MASTER, .6), /live parameter target failed/u);
	assert.equal(f.canonicalGain(), 1);
});

test('committing beneath an authored Read lane restores its future events without rebuilding programme history', async t => {
	const f = await fixture(t);
	const lane = { id: 'read', address: MASTER, timebase: 'absolute-samples' as const,
		points: [{ id: 'a', position: 0, value: .2 }, { id: 'b', position: 192_000, value: .8 }], segments: [{ kind: 'hold' as const }] };
	f.controller.actions.edit.commit({ type: 'automation-lane/set', laneId: lane.id, expected: null, lane }); await settle(3);
	await f.controller.actions.transport.playPause();
	const source = f.context.bufferSources.at(-1); assert.ok(source);
	const restores: unknown[] = [], restore = f.engine.restoreScheduledAutomationLane.bind(f.engine);
	f.engine.restoreScheduledAutomationLane = value => { restores.push(value); return restore(value); };
	f.context.currentTime = .6;
	f.controller.actions.mixer.beginParameterGesture(MASTER);
	f.controller.actions.mixer.commitParameterGesture(MASTER, .6); await settle(3);
	assert.equal(f.context.bufferSources.at(-1), source);
	assert.deepEqual(restores, [lane]);
	assert.ok(f.context.gains.some(node => node.gain.events.some(event => event[1] === .8 && event[2] === 4)),
		'the original future automation event remains scheduled on the retained graph');
	assert.equal(await f.runtimeGain(), .6);
	assert.deepEqual(f.controller.getSnapshot().project?.automationLanes, [lane]);
});

test('legacy envelope targets retain their ordinary rebuild fallback and gain continuation', async t => {
	const f = await fixture(t, 1, false);
	f.controller.actions.mixer.updateMaster({ envelope: [{ frame: 0, value: .2 }, { frame: 192_000, value: .8 }] }); await settle(3);
	await f.controller.actions.transport.playPause();
	f.context.currentTime = .6;
	f.controller.actions.mixer.beginParameterGesture(MASTER);
	f.controller.actions.mixer.commitParameterGesture(MASTER, .5); await settle(3);
	assert.ok(f.context.gains.some(node => node.gain.events.some(event => event[1] === .4 && event[2] === 4)),
		'the future envelope gain must still multiply the newly adopted .5 static value');
});

for (const scope of ['master', 'track', 'group'] as const) test(`live ${scope} adoption retains inherited folder mute across Pause and Play`, async t => {
	const f = await fixture(t);
	const trackId = f.controller.getSnapshot().selectedTrackId; assert.ok(typeof trackId === 'string');
	const folderId = f.controller.actions.trackFolders.wrapSelection([trackId], 'Muted'); assert.ok(typeof folderId === 'string');
	const lane = normalizeAutomationLaneV21({ id: 'mute', address: { kind: 'strip', strip: { kind: 'track', id: trackId }, parameterId: 'mute' },
		timebase: 'absolute-samples', points: [{ id: 'zero', position: 0, value: 0 }], segments: [] });
	f.controller.actions.edit.commit({ type: 'automation-lane/set', laneId: lane.id, expected: null, lane });
	f.controller.actions.trackFolders.update(folderId, { mute: true });
	await settle(3);
	await f.controller.actions.transport.playPause();
	assert.equal(currentMuteGain(f.engine, lane.address), 0);
	const before = structuredClone(f.controller.getSnapshot().project);
	const address = { kind: 'strip' as const, strip: scope === 'master' ? { kind: 'master' as const }
		: { kind: scope === 'track' ? 'track' as const : 'mixer-node' as const, id: scope === 'track' ? trackId : folderId }, parameterId: 'gain' as const };
	f.controller.actions.mixer.beginParameterGesture(address);
	f.controller.actions.mixer.commitParameterGesture(address, .5);
	await settle(3);
	await f.controller.actions.transport.playPause();
	await f.controller.actions.transport.playPause();
	assert.equal(currentMuteGain(f.engine, lane.address), 0, 'a local mute=0 lane cannot reopen its explicitly muted ancestor');
	assert.deepEqual(f.controller.getSnapshot().project?.trackFolders, before?.trackFolders);
	assert.deepEqual(f.controller.getSnapshot().project?.automationLanes, before?.automationLanes);
});

test('an admitted live Tremolo parameter commit retains folder mute across Pause and Play', async t => {
	const f = await fixture(t);
	const trackId = f.controller.getSnapshot().selectedTrackId; assert.ok(typeof trackId === 'string');
	const effectId = f.controller.actions.effects.add({ type: 'tremolo', scope: 'track', trackId }); assert.ok(typeof effectId === 'string');
	const folderId = f.controller.actions.trackFolders.wrapSelection([trackId], 'Muted'); assert.ok(typeof folderId === 'string');
	const lane = normalizeAutomationLaneV21({ id: 'mute', address: { kind: 'strip', strip: { kind: 'track', id: trackId }, parameterId: 'mute' },
		timebase: 'absolute-samples', points: [{ id: 'zero', position: 0, value: 0 }], segments: [] });
	f.controller.actions.edit.commit({ type: 'automation-lane/set', laneId: lane.id, expected: null, lane });
	f.controller.actions.trackFolders.update(folderId, { mute: true });
	await settle(3);
	await f.controller.actions.transport.playPause();
	assert.equal(currentMuteGain(f.engine, lane.address), 0);
	f.controller.actions.effects.beginRackEffectGesture('track', trackId, effectId);
	f.controller.actions.effects.commitRackEffectGesture('track', trackId, effectId, { depth: 50 });
	await settle(3);
	await f.controller.actions.transport.playPause();
	await f.controller.actions.transport.playPause();
	assert.equal(currentMuteGain(f.engine, lane.address), 0);
});

function currentMuteGain(engine: ReturnType<typeof createAudioEditorEngine>, address: unknown): number {
	const graph: unknown = Reflect.get(engine, 'graph');
	assert.ok(graph && typeof graph === 'object' && 'parameterRegistry' in graph);
	assert.ok(graph.parameterRegistry instanceof ScheduledParameterRegistry);
	const target = graph.parameterRegistry.get(address);
	assert.ok(target?.binding.kind === 'audio-param');
	const param = target.binding.params[0]?.param; assert.ok(param);
	return param.value;
}
