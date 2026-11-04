/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import type { ChunkStreamClientLike } from '../src/common/editor/engine/clip-scheduler.ts';
import { buildProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import { registerParallelStackPlayback } from '../src/common/editor/engine/parallel-stack-playback.ts';
import type { EngineSourceResolver } from '../src/common/editor/engine/types.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { deferred } from './helpers/async-test-control.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

function fixture() {
	const context = new MockAudioContext();
	const project: EngineProject = {
		id: 'edit-handoff', title: 'Before edit', sampleRate: 48_000,
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 480_000, gain: 1 }],
		tracks: [{ id: 'track', clipIds: ['clip'], gain: 1, pan: 0, mute: false, solo: false, effects: [] }],
		master: { gain: 1, effects: [] },
	};
	const sources = new Map([['source', new MockAudioBuffer(1, 480_000, 48_000) as unknown as AudioBuffer]]);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext });
	engine.loadProject(project, sources);
	return { engine, context, project, sources, host: engine as unknown as EngineRuntimeHost };
}

async function waitForResume(context: MockAudioContext) {
	const entered = deferred<void>();
	const ready = deferred<void>();
	context.resume = () => { entered.resolve(); return ready.promise; };
	return { entered: entered.promise, release: () => ready.resolve() };
}

test('a replacement keeps the old graph audible until readiness, then advances to the current playback frame', async () => {
	const { engine, context, project, sources, host } = fixture();
	await engine.play();
	const oldGraph = host.graph;
	const oldSource = context.bufferSources.at(-1)!;
	const resume = await waitForResume(context);
	try {
		const applying = engine.applyProject({ ...project, title: 'After edit' }, sources);
		await resume.entered;
		context.currentTime = 2;
		assert.equal(oldSource.stopped, undefined, 'old source must survive candidate preparation');
		assert.equal(host.graph, oldGraph);
		assert.equal(engine.getState().state, 'playing');
		assert.equal(engine.getPositionFrames(), 96_000);
		resume.release(); await applying;
		assert.notEqual(host.graph, oldGraph);
		assert.equal(engine.getState().state, 'playing');
		const next = context.bufferSources.at(-1)!;
		assert.ok(next.started[1]! >= 2, 'replacement cannot repeat the time spent preparing');
		assert.equal(host.project?.title, 'After edit');
	} finally { resume.release(); await engine.dispose(); }
});

test('a failed replacement leaves old playback running', async () => {
	const { engine, context, project, sources, host } = fixture();
	await engine.play();
	const oldGraph = host.graph;
	const oldSource = context.bufferSources.at(-1)!;
	context.resume = () => Promise.reject(new Error('Device temporarily unavailable'));
	try {
		await assert.rejects(engine.applyProject({ ...project, title: 'Rejected edit' }, sources), /Device temporarily/u);
		assert.equal(host.graph, oldGraph);
		assert.equal(oldSource.stopped, undefined);
		assert.equal(engine.getState().state, 'playing');
		assert.equal(host.project?.title, 'Before edit');
	} finally { await engine.dispose(); }
});

for (const action of ['stop', 'pause', 'seek', 'abort'] as const) test(`${action} retires an edit candidate without resurrecting playback`, async () => {
	const { engine, context, project, sources, host } = fixture();
	await engine.play();
	const signal = new AbortController();
	const resume = await waitForResume(context);
	const applying = engine.applyProject({ ...project, title: 'Cancelled edit' }, sources, { signal: signal.signal });
	try {
		await resume.entered;
		if (action === 'abort') signal.abort();
		else if (action === 'seek') engine.seek(48_000);
		else engine[action]();
		resume.release();
		await assert.rejects(applying, { name: 'AbortError' });
		assert.equal(host.project?.title, 'Before edit');
		if (action === 'stop' || action === 'pause') assert.equal(engine.getState().state, action === 'stop' ? 'stopped' : 'paused');
		if (action === 'abort') assert.equal(engine.getState().state, 'playing');
	} finally { resume.release(); await engine.dispose(); }
});

test('a newer edit supersedes a candidate without stopping the newer graph', async () => {
	const { engine, context, project, sources, host } = fixture();
	await engine.play();
	const resume = await waitForResume(context);
	const first = engine.applyProject({ ...project, title: 'Superseded' }, sources);
	try {
		await resume.entered;
		context.resume = async () => undefined;
		await engine.applyProject({ ...project, title: 'Latest' }, sources);
		resume.release(); await assert.rejects(first, { name: 'AbortError' });
		assert.equal(host.project?.title, 'Latest');
		assert.equal(engine.getState().state, 'playing');
	} finally { resume.release(); await engine.dispose(); }
});

test('pitch-preserving speed playback continues through an edit using a freshly rendered mix', async () => {
	const { engine, context, project, sources } = fixture();
	const render = deferred<AudioBuffer>();
	let renders = 0;
	engine.renderMix = () => ++renders === 1
		? Promise.resolve(new MockAudioBuffer(1, 480_000, 48_000) as unknown as AudioBuffer)
		: render.promise;
	const speeds: number[] = [];
	await engine.playAtSpeed(1.5, { preservePitch: true, pitchPreserver: async (channels, _sampleRate, speed) => {
		speeds.push(speed); return channels;
	} });
	const oldSource = context.bufferSources.at(-1)!;
	try {
		const applying = engine.applyProject({ ...project, title: 'Speed edit' }, sources);
		await Promise.resolve(); await Promise.resolve();
		assert.equal(oldSource.stopped, undefined);
		render.resolve(new MockAudioBuffer(1, 480_000, 48_000) as unknown as AudioBuffer);
		await applying;
		assert.deepEqual(speeds, [1.5, 1.5]);
		assert.equal(engine.getState().state, 'playing');
		assert.equal(engine.getState().playbackMode, 'staffpad');
		assert.equal(engine.getState().playbackRate, 1.5);
	} finally { render.resolve(new MockAudioBuffer(1, 1, 48_000) as unknown as AudioBuffer); await engine.dispose(); }
});


test('the old and new output gates switch at the same audio-clock boundary', async () => {
	const { engine, context, project, sources, host } = fixture();
	await engine.play();
	const oldGate = host.graph?.outputGate;
	try {
		await engine.applyProject({ ...project, title: 'Gated replacement' }, sources);
		const newGate = host.graph?.outputGate;
		assert.ok(oldGate); assert.ok(newGate);
		const oldEvents = (oldGate.gain as unknown as { events: unknown[][] }).events;
		const newEvents = (newGate.gain as unknown as { events: unknown[][] }).events;
		assert.deepEqual(oldEvents.at(-1), ['set', 0, host.playbackStartTime]);
		assert.deepEqual(newEvents.at(-1), ['set', 1, host.playbackStartTime]);
		assert.ok(host.playbackStartTime > context.currentTime);
	} finally { await engine.dispose(); }
});

test('a refresh while a prior handoff is still scheduled does not advance the timeline twice', async () => {
	const { engine, project, sources, host } = fixture();
	await engine.play();
	try {
		await engine.applyProject({ ...project, title: 'First' }, sources);
		const firstFrame = host.playbackStartFrame;
		await engine.applyProject({ ...project, title: 'Second' }, sources);
		assert.equal(host.playbackStartFrame, firstFrame);
	} finally { await engine.dispose(); }
});

test('a delayed replacement follows the loop clock through wraps', async () => {
	const { engine, context, project, sources, host } = fixture();
	const looping = { ...project, loop: { enabled: true, startFrame: 48_000, endFrame: 96_000 } };
	engine.loadProject(looping, sources); engine.seek(72_000);
	await engine.play();
	const resume = await waitForResume(context);
	try {
		const applying = engine.applyProject({ ...looping, title: 'Loop edit' }, sources);
		await resume.entered; context.currentTime = 2.25;
		resume.release(); await applying;
		assert.equal(host.playbackStartFrame, 85_920);
		assert.equal(host.playbackStartTime, 2.29);
	} finally { resume.release(); await engine.dispose(); }
});

test('slow chunk priming reserves a new future frame and keeps old audio through the missed reservation', async () => {
	const { engine, context, project, host } = fixture();
	await engine.play();
	const oldGraph = host.graph;
	const oldSource = context.bufferSources.at(-1)!;
	const entered = deferred<void>(); const primed = deferred<void>();
	const opened: number[] = []; const starts: number[] = []; const cancelled: number[] = [];
	const client: ChunkStreamClientLike = {
		open(options) {
			const index = opened.length;
			opened.push(options.startFrame ?? -1);
			const done = deferred<void>();
			if (index === 0) entered.resolve();
			return { ready: Promise.resolve(), primed: index === 0 ? primed.promise : Promise.resolve(), done: done.promise,
				play: ({ contextStartFrame }) => { starts.push(contextStartFrame); },
				cancel: () => { cancelled.push(index); done.resolve(); } };
		},
	};
	host.chunkStreamClient = client;
	host.chunkAudioNodeFactory = async () => context.make('chunk-stream', {
		port: { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} },
	}) as unknown as AudioWorkletNode;
	const provider = { channelCount: 1, frameCount: 480_000, chunkFrames: 65_536, sampleRate: 48_000,
		readStorageChunk: () => Promise.resolve([new Float32Array(65_536)]) };
	try {
		const applying = engine.applyProject({ ...project, title: 'Streamed edit' }, new Map(), { chunkSources: new Map([['source', provider]]) });
		await entered.promise; context.currentTime = 1;
		assert.equal(oldSource.stopped, undefined); assert.equal(host.graph, oldGraph);
		primed.resolve(); await applying;
		assert.equal(opened.length, 2, 'the missed start reopens the stream at the advancing frame');
		assert.ok(opened[1]! >= 48_000);
		assert.deepEqual(cancelled, [0]);
		assert.equal(starts.length, 1, 'the first candidate never becomes audible');
		assert.equal(host.playbackStartFrame, starts[0]);
		assert.equal(engine.getState().state, 'playing');
	} finally { primed.resolve(); await engine.dispose(); }
});

test('a prepared worker graph can be cancelled without stopping the old graph or resurrecting late sources', async () => {
	const { engine, context, project, sources, host } = fixture();
	await engine.play(); const oldGraph = host.graph;
	const entered = deferred<void>(); const ready = deferred<void>(); const signal = new AbortController();
	let lateGraph: ReturnType<typeof buildProjectGraph> | undefined;
	registerParallelStackPlayback(host, async (request) => {
		const graph = buildProjectGraph(request.context, request.destination, request.project, { graph: 'legacy' });
		lateGraph = graph; entered.resolve(); await ready.promise; return graph;
	});
	try {
		const applying = engine.applyProject({ ...project, title: 'Workers' }, sources, { graph: 'v21', signal: signal.signal });
		await entered.promise; assert.equal(host.graph, oldGraph);
		signal.abort(); await assert.rejects(applying, { name: 'AbortError' });
		ready.resolve(); await new Promise<void>(resolve => { setImmediate(resolve); });
		assert.ok(lateGraph?.nodes.every(node => (node as unknown as { disconnected: boolean }).disconnected));
		assert.equal(host.graph, oldGraph); assert.equal(engine.getState().state, 'playing');
		assert.equal(context.bufferSources.filter(source => source.started).length, 1);
	} finally { ready.resolve(); await engine.dispose(); }
});

test('loading before cache materialization still captures the ready resolver when Play starts', async () => {
	const { engine, context, project, sources } = fixture();
	const original = sources.get('source')!;
	const processed = new MockAudioBuffer(1, 480_000, 48_000) as unknown as AudioBuffer;
	let current = original;
	const resolver: EngineSourceResolver = Object.assign(() => ({ buffer: current }), {
		snapshot: () => { const buffer = current; return () => ({ buffer }); },
	});
	engine.setSourceResolver(resolver); engine.loadProject(project, sources); current = processed;
	try {
		await engine.play(); assert.equal(context.bufferSources.at(-1)?.buffer, processed);
	} finally { await engine.dispose(); }
});

test('a second replacement cannot swap before a prior audible boundary when graph latency decreases', async () => {
	const { engine, project, sources, host } = fixture();
	await engine.play();
	let latency = 4_800;
	registerParallelStackPlayback(host, async request => {
		const graph = buildProjectGraph(request.context, request.destination, request.project, { graph: 'legacy' });
		return Object.assign(graph, { latencyFrames: latency });
	});
	try {
		await engine.applyProject({ ...project, title: 'Latent graph' }, sources, { graph: 'v21' });
		const firstBoundary = host.playbackStartTime; const firstFrame = host.playbackStartFrame;
		latency = 0;
		await engine.applyProject({ ...project, title: 'Dry graph' }, sources, { graph: 'v21' });
		assert.ok(host.playbackStartTime >= firstBoundary);
		assert.equal(host.playbackStartFrame, firstFrame);
	} finally { await engine.dispose(); }
});

test('worker faults on a promoted candidate still belong to the live engine', async t => {
	const { engine, project, sources, host } = fixture();
	await engine.play();
	let fail: ((error: Error) => void) | undefined;
	registerParallelStackPlayback(host, async request => {
		fail = request.onFailure;
		return buildProjectGraph(request.context, request.destination, request.project, { graph: 'legacy' });
	});
	t.mock.method(console, 'error', () => undefined);
	const failures: unknown[] = []; engine.subscribePlaybackErrors(error => { failures.push(error); });
	try {
		await engine.applyProject({ ...project, title: 'Worker replacement' }, sources, { graph: 'v21' });
		const fault = new Error('Promoted worker deadline'); assert.ok(fail); fail(fault);
		assert.deepEqual(failures, [fault]);
		assert.equal(engine.getState().state, 'stopped');
	} finally { await engine.dispose(); }
});

test('adding exact audio warp keeps old playback until the bounded replacement render is ready', async () => {
	const { engine, context, project, sources, host } = fixture();
	await engine.play(); const oldGraph = host.graph; const oldSource = context.bufferSources.at(-1)!;
	host.audioWarpRealtimeAcceleration = false;
	const entered = deferred<void>(); const rendered = deferred<void>(); let renders = 0;
	host.softwareRenderer = async options => {
		if (++renders === 1) { entered.resolve(); await rendered.promise; }
		return { channels: Array.from({ length: 2 }, () => new Float32Array(Number(options.endFrame) - Number(options.captureStartFrame))), sampleRate: 48_000 };
	};
	const warped = { ...project, clips: project.clips!.map(clip => ({ ...clip,
		warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 240_000, source: 120_000, mode: 'forward' }, { outer: 480_000, source: 480_000, mode: 'forward' }] },
	})) };
	try {
		const applying = engine.applyProject(warped, sources);
		await entered.promise; context.currentTime = 1;
		assert.equal(host.graph, oldGraph); assert.equal(oldSource.stopped, undefined);
		rendered.resolve(); await applying;
		assert.equal(engine.getState().state, 'playing');
		assert.equal(engine.getState().playbackMode, 'audio-warp-exact');
		assert.ok(host.playbackStartFrame >= 48_000);
		assert.ok(renders >= 2, 'missed reservation uses a fresh exact window at the advancing frame');
	} finally { rendered.resolve(); await engine.dispose(); }
});

test('an edit near the audition end lets its last samples play before committing stopped data', async () => {
	const { engine, context, project, sources, host } = fixture();
	engine.setPlayRange({ startFrame: 0, endFrame: 96_000 }); await engine.play();
	const oldSource = context.bufferSources.at(-1)!;
	context.currentTime = 1.99;
	try {
		const applying = engine.applyProject({ ...project, title: 'At audition end' }, sources);
		await new Promise<void>(resolve => { setImmediate(resolve); });
		assert.equal(oldSource.stopped, undefined, 'the future handoff reservation must not truncate the audition');
		context.currentTime = 2; await applying;
		assert.equal(host.project?.title, 'At audition end');
		assert.equal(engine.getState().state, 'stopped');
		assert.equal(engine.getPositionFrames(), 96_000);
	} finally { await engine.dispose(); }
});

test('an edit that finishes after natural playback end loads its new data without restarting', async t => {
	const { engine, context, project, sources, host } = fixture();
	const originalInterval = globalThis.setInterval;
	let tick: (() => void) | undefined;
	t.mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) => {
		tick = args[0] as () => void;
		return originalInterval(...args);
	});
	await engine.play(); const resume = await waitForResume(context);
	try {
		const applying = engine.applyProject({ ...project, title: 'Ready after end' }, sources);
		await resume.entered;
		context.currentTime = host.playEndFrame / 48_000 + 1;
		assert.ok(tick); tick(); assert.equal(engine.getState().state, 'stopped');
		resume.release(); await applying;
		assert.equal(host.project?.title, 'Ready after end');
		assert.equal(engine.getState().state, 'stopped');
	} finally { resume.release(); await engine.dispose(); }
});

test('a shorter exact-warp replacement commits stopped data when the current position is past its end', async () => {
	const { engine, context, project, sources, host } = fixture();
	await engine.play(); context.currentTime = 2;
	host.audioWarpRealtimeAcceleration = false;
	let renders = 0;
	host.softwareRenderer = () => { renders++; throw new Error('No empty render window may be requested'); };
	const shorter = { ...project, title: 'Shortened warp', clips: project.clips!.map(clip => ({ ...clip, durationFrames: 48_000,
		warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' }, { outer: 48_000, source: 48_000, mode: 'forward' }] },
	})) };
	try {
		await engine.applyProject(shorter, sources);
		assert.equal(host.project?.title, 'Shortened warp');
		assert.equal(engine.getState().state, 'stopped');
		assert.equal(renders, 0);
		assert.equal(engine.getPositionFrames(), 48_000);
	} finally { await engine.dispose(); }
});


test('retired graph cleanup waits for audio time when the context clock pauses before the handoff', async t => {
	const { engine, context, project, sources, host } = fixture();
	t.mock.timers.enable({ apis: ['setTimeout'] });
	await engine.play(); const oldSource = context.bufferSources.at(-1)!;
	try {
		await engine.applyProject({ ...project, title: 'Suspended boundary' }, sources);
		t.mock.timers.tick(100);
		assert.equal(oldSource.stopped, undefined, 'wall time cannot retire still-audible old audio');
		context.currentTime = host.playbackStartTime;
		t.mock.timers.tick(100);
		assert.equal(oldSource.stopped, true);
	} finally { await engine.dispose(); }
});
