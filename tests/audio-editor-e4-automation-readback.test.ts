/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperAutomationControllerBinding } from '../src/soundscaper/editor-automation-controller.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { ScheduledParameterRegistry, type ScheduledParameterMessage } from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import { scheduleAutomationLaneV21 } from '../src/common/editor/engine/automation-lane-scheduler-v21.ts';
import { engineAutomationControlMethods } from '../src/common/editor/engine/automation-control-v21.ts';
import { ENGINE_ASSERT_ACTIVE } from '../src/common/editor/engine/runtime-symbols.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';

for (const mode of ['touch', 'latch', 'write', 'trim'] as const) test(`cancelled ${mode} restores the future lane schedule without changing history`, () => {
	const f = fixture();
	f.binding.actions.setMode(mode, 'gain');
	const token = f.binding.actions.beginGesture('gain', .7);
	f.binding.actions.previewGesture(token, .9);
	f.context.currentTime = 1.5;
	f.binding.actions.cancelGesture(token);
	assert.equal(f.commits(), 0);
	assert.ok(f.events.some(event => event.value === .8 && event.time === 4), 'restore the independently authored future gain step');
	assert.equal(f.events.at(-1)?.time, 10);
	assert.equal(f.binding.actions.getSnapshot().active, false);
	f.binding.dispose();
});

test('a no-gesture lane keeps its original future schedule', () => {
	const f = fixture();
	f.binding.actions.setMode('touch', 'gain');
	assert.ok(f.events.some(event => event.value === .8 && event.time === 4));
	assert.equal(f.commits(), 0);
	f.binding.dispose();
});

test('cancellation restores every already-queued loop body, including a partial first iteration', () => {
	for (const startFrame of [0, 96_000]) {
		const f = fixture({ loop: true, startFrame });
		f.binding.actions.setMode('touch', 'gain');
		const token = f.binding.actions.beginGesture('gain', .7);
		f.binding.actions.previewGesture(token, .9);
		f.context.currentTime = 1.5; f.binding.actions.cancelGesture(token);
		const firstStep = (192_000 - startFrame) / 48_000;
		for (const time of [firstStep, firstStep + 5, firstStep + 10]) {
			assert.ok(f.events.some(event => event.value === .8 && event.time === time), `retained step at ${time}`);
		}
		assert.equal(f.events.at(-1)?.time, 15 - startFrame / 48_000);
		assert.equal(f.commits(), 0); f.binding.dispose();
	}
});

test('the current loop cursor resumes on the original input clock after multiple iterations', () => {
	const f = fixture({ loop: true }); f.context.currentTime = 7;
	f.binding.actions.setMode('latch', 'gain');
	const token = f.binding.actions.beginGesture('gain', .7);
	f.binding.actions.previewGesture(token, .9);
	f.context.currentTime = 7.5; f.binding.actions.cancelGesture(token);
	for (const time of [9, 14]) assert.ok(f.events.some(event => event.value === .8 && event.time === time));
	assert.equal(f.events.at(-1)?.time, 15);
	f.binding.dispose();
});

for (const sampleRate of [44_100, 48_000, 96_000]) test(`readback keeps project ${sampleRate} and native 48k clocks, speed and path latency`, () => {
	const f = fixture({ sampleRate, playbackRate: 1.25, graphLatency: 256, targetLatency: 64 });
	f.context.currentTime = .25; f.binding.actions.setMode('touch', 'gain');
	const token = f.binding.actions.beginGesture('gain', .7);
	f.binding.actions.previewGesture(token, .9);
	f.context.currentTime = .5; f.binding.actions.cancelGesture(token);
	const expectedTime = 192_000 / (sampleRate * 1.25) + 64 / 48_000;
	assert.ok(f.events.some(event => event.value === .8 && Math.abs(event.time - expectedTime) < 1e-12));
	f.binding.dispose();
});

test('readback scheduling failure preflights the queued-window work bound before replacing any events', () => {
	const f = fixture({ loop: true });
	f.binding.actions.setMode('touch', 'gain');
	const token = f.binding.actions.beginGesture('gain', .7);
	f.binding.actions.previewGesture(token, .9);
	const before = structuredClone(f.events);
	f.engine.loopScheduleTime = 1e9;
	assert.throws(() => f.binding.actions.cancelGesture(token), /bounded/iu);
	assert.deepEqual(f.events, before);
	assert.equal(f.commits(), 0); f.binding.dispose();
});

test('musical gain readback retains the authoritative beat clock and future step', () => {
	const f = fixture({ musical: true });
	f.binding.actions.setMode('touch', 'gain'); const token = f.binding.actions.beginGesture('gain', .7);
	f.context.currentTime = 1.5; f.binding.actions.cancelGesture(token);
	assert.ok(f.events.some(event => event.value === .8 && event.time === 4));
	f.binding.dispose();
});

test('message targets receive a complete future continuation with their existing revision protocol', () => {
	const f = fixture({ message: true });
	f.binding.actions.setMode('touch', 'gain'); const token = f.binding.actions.beginGesture('gain', .7);
	f.binding.actions.previewGesture(token, .9);
	const before = f.packets.at(-1)!;
	f.context.currentTime = 1.5; f.binding.actions.cancelGesture(token);
	const restored = f.packets.at(-1)!;
	assert.ok(restored.revision > before.revision);
	assert.equal(restored.contextStartTime, 1.5);
	assert.ok(restored.events.some(event => event.value === .8 && event.frameOffset === 120_000));
	assert.equal(f.commits(), 0); f.binding.dispose();
});

test('a retired graph target cannot publish queued loop continuation to its replacement', () => {
	const f = fixture({ loop: true });
	f.binding.actions.setMode('touch', 'gain'); const token = f.binding.actions.beginGesture('gain', .7);
	const incoming: number[] = [];
	f.onWrite(() => {
		f.registry.clear();
		f.registry.registerMessageTarget(stripParameterDescriptor(f.lane.address), packet => { incoming.push(packet.revision); });
	});
	assert.throws(() => f.binding.actions.cancelGesture(token), /active graph/iu);
	assert.deepEqual(incoming, []);
	assert.equal(f.binding.actions.getSnapshot().active, false);
	assert.equal(f.commits(), 0); f.binding.dispose();
});

test('retiring the graph before cancellation makes restoration inert', () => {
	const f = fixture(); f.binding.actions.setMode('touch', 'gain');
	const token = f.binding.actions.beginGesture('gain', .7), before = structuredClone(f.events);
	Reflect.set(f.engine, 'graph', null);
	assert.doesNotThrow(() => f.binding.actions.cancelGesture(token));
	assert.deepEqual(f.events, before);
	assert.equal(f.commits(), 0); f.binding.dispose();
});

interface Event { value: number; time: number }
function fixture(options: Readonly<{ loop?: boolean; startFrame?: number; sampleRate?: number;
	playbackRate?: number; graphLatency?: number; targetLatency?: number; musical?: boolean; message?: boolean }> = {}) {
	const sampleRate = options.sampleRate ?? 48_000, playbackRate = options.playbackRate ?? 1;
	const startFrame = options.startFrame ?? 0, targetLatency = options.targetLatency ?? 0;
	const graphLatency = options.graphLatency ?? 0, windowEnd = options.loop ? 240_000 : 480_000;
	const project = createSoundscaperProject({ id: 'readback', sampleRate, tracks: [createAudioTrack({ id: 'voice' })],
		automationLanes: [{ id: 'gain', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: options.musical ? 'musical-beats' : 'absolute-samples',
			points: [{ id: 'a', position: options.musical ? { num: 0, den: 1 } : 0, value: .2 },
				{ id: 'b', position: options.musical ? { num: 8, den: 1 } : 192_000, value: .8 },
				{ id: 'c', position: options.musical ? { num: 20, den: 1 } : 480_000, value: .8 }],
			segments: [{ kind: 'hold' }, { kind: 'hold' }] }] });
	const lane = project.automationLanes[0]!;
	const registry = new ScheduledParameterRegistry();
	const events: Event[] = [], packets: ScheduledParameterMessage[] = [];
	let onWrite: (() => void) | null = null;
	const param = {
		setValueAtTime(value: number, time: number) { events.push({ value, time }); const callback = onWrite; onWrite = null; callback?.(); },
		linearRampToValueAtTime(value: number, time: number) { events.push({ value, time }); },
		cancelScheduledValues(time: number) {
			// Native AudioParam cancellation removes events at/after the given time.
			for (let index = events.length - 1; index >= 0; index--) if (events[index]!.time >= time) events.splice(index, 1);
		},
	} as unknown as AudioParam;
	if (options.message) registry.registerMessageTarget(stripParameterDescriptor(lane.address), packet => { packets.push(packet); }, { latencyFrames: targetLatency });
	else registry.registerAudioParam(stripParameterDescriptor(lane.address), param, { latencyFrames: targetLatency });
	const schedule = (fromFrame: number, time: number) => scheduleAutomationLaneV21(lane, registry, {
		fromFrame, toFrame: windowEnd, contextStartTime: time, sampleRate, contextSampleRate: 48_000, transportRate: playbackRate, tempoMap: project.tempoMap });
	schedule(startFrame, 0);
	const firstLoop = (windowEnd - startFrame) / (sampleRate * playbackRate), period = windowEnd / (sampleRate * playbackRate);
	if (options.loop) { schedule(0, firstLoop); schedule(0, firstLoop + period); }
	const context = { currentTime: 1, sampleRate: 48_000 };
	const engine = { context, project, graph: { parameterRegistry: registry, latencyFrames: graphLatency },
		sampleRate, playbackRate, state: 'playing', playbackStartFrame: startFrame, playbackStartTime: graphLatency / 48_000,
		playEndFrame: windowEnd, loop: { enabled: Boolean(options.loop), startFrame: 0, endFrame: windowEnd },
		loopScheduleTime: options.loop ? firstLoop + 2 * period : 0,
		getPositionFrames: () => {
			const elapsed = Math.max(0, Math.floor((context.currentTime - graphLatency / 48_000) * sampleRate * playbackRate));
			return options.loop ? elapsed < windowEnd - startFrame ? startFrame + elapsed
				: (elapsed - (windowEnd - startFrame)) % windowEnd : Math.min(windowEnd, startFrame + elapsed);
		},
		getState: () => ({ state: 'playing' }),
		subscribePosition: () => () => {}, subscribeState: () => () => {},
		[ENGINE_ASSERT_ACTIVE]() {},
		previewScheduledParameter(address: unknown, value: number) {
			return engineAutomationControlMethods.previewScheduledParameter.call(engine as unknown as EngineRuntimeHost, address, value);
		},
		restoreScheduledAutomationLane(value: unknown) {
			const methods = engineAutomationControlMethods as unknown as {
				restoreScheduledAutomationLane?: (this: EngineRuntimeHost, lane: unknown) => boolean;
			};
			return methods.restoreScheduledAutomationLane?.call(engine as unknown as EngineRuntimeHost, value) ?? false;
		},
		get positionFrame() { return engine.getPositionFrames(); },
	};
	let commits = 0;
	const binding = createSoundscaperAutomationControllerBinding({ project, engine,
		actions: { edit: { commit: () => { commits++; throw new Error('Cancel must never publish a command.'); } } },
		getSnapshot: () => ({ readOnly: false, lockReadOnly: false, transportState: 'playing' }),
		subscribe: () => () => {},
	});
	return { binding, engine, context, events, packets, registry, lane, onWrite(callback: () => void) { onWrite = callback; }, commits: () => commits };
}
