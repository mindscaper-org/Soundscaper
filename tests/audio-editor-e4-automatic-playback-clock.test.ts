/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode } from './helpers/audio-editor-runtime-harness.js';

function project(sampleRate: number, filter = false) {
	const source = createAudioSource({ id: 'recording', sampleRate, frameCount: 4800, channelCount: 2 });
	return createSoundscaperProject({ id: `project-${sampleRate}`, sampleRate, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'], effects: filter
			? [{ id: 'filter', type: 'lowpass-filter', params: { frequency: 30_000, rolloff: 6 } }] : [] }, sampleRate)] });
}

class DeviceContext extends MockAudioContext {
	closeCalls = 0;
	closeBarrier: Promise<void> | null = null;
	constructor(options?: AudioContextOptions) { super({ sampleRate: options?.sampleRate ?? 44_100 }); }
	override async close() {
		this.closeCalls++;
		await this.closeBarrier;
		await super.close();
	}
}

function fixture(mode: 'honor' | 'ignore' | 'unsupported' | 'unsupported-low' = 'honor') {
	const contexts: DeviceContext[] = [], requested: Array<number | undefined> = [];
	const engine = createAudioEditorEngine({ audioContextFactory: (options?: AudioContextOptions) => {
		requested.push(options?.sampleRate);
		if ((mode === 'unsupported' && options?.sampleRate === 96_000)
			|| (mode === 'unsupported-low' && options?.sampleRate === 8000)) throw new DOMException('Unsupported rate', 'NotSupportedError');
		const context = new DeviceContext(mode === 'ignore' ? undefined : options);
		contexts.push(context);
		return context as unknown as EngineAudioContext;
	}, meterInterval: 1000 });
	return { engine, contexts, requested };
}

test('automatic playback creates its context at the current ordinary project clock', async context => {
	const f = fixture(); context.after(() => f.engine.dispose());
	f.engine.loadProject(project(96_000));
	assert.equal((await f.engine.getAudioContext({ resume: false })).sampleRate, 96_000);
	assert.deepEqual(f.requested, [96_000]);
});

test('an admitted project clock below a device minimum falls back without churn', async context => {
	const f = fixture('unsupported-low'); context.after(() => f.engine.dispose());
	assert.throws(() => project(6000), /between 8000/u);
	f.engine.loadProject(project(8000), new Map([['recording', new MockAudioBuffer(2, 4800, 8000) as unknown as AudioBuffer]]));
	const original = await f.engine.getAudioContext({ resume: false });
	assert.equal(original.sampleRate, 44_100);
	assert.deepEqual(f.requested, [8000, undefined]);
	assert.equal((await f.engine.getAudioContext({ resume: false })) === original, true);
	await f.engine.play();
	assert.equal(f.engine.getState().state, 'playing');
	assert.deepEqual(f.requested, [8000, undefined]);
	f.engine.stop();
});

test('an idle automatic context follows replacement projects without becoming an explicit rate pin', async context => {
	const f = fixture(); context.after(() => f.engine.dispose());
	const device = await f.engine.getAudioContext({ resume: false });
	assert.equal(device.sampleRate, 44_100);
	f.engine.loadProject(project(96_000));
	const high = await f.engine.getAudioContext({ resume: false });
	assert.equal(high.sampleRate, 96_000); assert.equal(f.contexts[0]!.closeCalls, 1);
	f.engine.loadProject(project(48_000));
	const ordinary = await f.engine.getAudioContext({ resume: false });
	assert.equal(ordinary.sampleRate, 48_000); assert.equal(f.contexts[1]!.closeCalls, 1);
	f.engine.loadProject(project(48_000));
	assert.equal((await f.engine.getAudioContext({ resume: false })) === ordinary, true);
});

test('explicit native or recording clock remains authoritative across project replacement', async context => {
	const f = fixture(); context.after(() => f.engine.dispose());
	const selected = await f.engine.getAudioContext({ resume: false, sampleRate: 44_100 });
	f.engine.loadProject(project(96_000));
	assert.equal((await f.engine.getAudioContext({ resume: false })) === selected, true);
	assert.equal(f.contexts[0]!.closeCalls, 0);
	assert.equal((await f.engine.getAudioContext({ resume: false, sampleRate: 48_000 })).sampleRate, 48_000);
	assert.equal((await f.engine.getAudioContext({ resume: false })).sampleRate, 48_000);
});

for (const mode of ['ignore', 'unsupported'] as const) test(`automatic ${mode} rate falls back once without context churn`, async context => {
	const f = fixture(mode); context.after(() => f.engine.dispose());
	f.engine.loadProject(project(96_000));
	const current = await f.engine.getAudioContext({ resume: false });
	assert.equal(current.sampleRate, 44_100);
	for (let count = 0; count < 3; count++) assert.equal((await f.engine.getAudioContext({ resume: false })) === current, true);
	assert.ok(f.requested.includes(96_000), 'the supported project clock is attempted before device fallback');
	assert.equal(f.contexts.length, 1); assert.equal(f.contexts[0]!.closeCalls, 0);
});

test('a later project owns automatic context creation while an earlier context finishes closing', async context => {
	const f = fixture(); context.after(() => f.engine.dispose());
	await f.engine.getAudioContext({ resume: false });
	let finish!: () => void;
	f.contexts[0]!.closeBarrier = new Promise<void>(resolve => { finish = resolve; });
	f.engine.loadProject(project(96_000));
	const outgoing = f.engine.getAudioContext({ resume: false });
	f.engine.loadProject(project(48_000));
	const incoming = await f.engine.getAudioContext({ resume: false });
	finish();
	assert.equal(incoming.sampleRate, 48_000);
	assert.equal((await outgoing) === incoming, true, 'a retired project cannot recreate its old clock after await');
	assert.equal(f.contexts.length, 2);
});

test('a pending output-device setup returns the incoming context after automatic project replacement', async context => {
	let finish!: () => void;
	const pending = new Promise<void>(resolve => { finish = resolve; });
	const contexts: DeviceContext[] = [];
	const engine = createAudioEditorEngine({ audioContextFactory: options => {
		const current = new DeviceContext(options), first = contexts.length === 0;
		Object.assign(current, { setSinkId: () => first ? pending : Promise.resolve() });
		contexts.push(current);
		return current as unknown as EngineAudioContext;
	} });
	context.after(() => engine.dispose());
	await engine.setOutputDevice('speaker-a');
	engine.loadProject(project(48_000));
	const outgoing = engine.getAudioContext({ resume: false });
	engine.loadProject(project(96_000));
	const incoming = await engine.getAudioContext({ resume: false });
	finish();
	assert.equal((await outgoing) === incoming, true, 'an input or processor caller must not adopt the closed outgoing context');
	assert.equal(contexts[0]!.state, 'closed');
	assert.equal(incoming.sampleRate, 96_000);
});

test('disposal during automatic context retirement cannot construct a replacement', async () => {
	const f = fixture(); await f.engine.getAudioContext({ resume: false });
	let finish!: () => void;
	f.contexts[0]!.closeBarrier = new Promise<void>(resolve => { finish = resolve; });
	f.engine.loadProject(project(96_000));
	const operation = f.engine.getAudioContext({ resume: false });
	const rejected = assert.rejects(operation, /disposed/iu);
	const disposed = f.engine.dispose(); finish(); await disposed; await rejected;
	assert.equal(f.contexts.length, 1);
});

test('automatic context reconciliation never orphans an attached native plug-in', async context => {
	const { createNativePluginEffectNode, releaseNativePluginRuntime } = await import('../src/common/editor/native-plugin-realtime-node.js');
	const saved = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: MockAudioWorkletNode });
	const f = fixture();
	context.after(async () => {
		releaseNativePluginRuntime('automatic-rate-native'); await f.engine.dispose();
		if (saved) Object.defineProperty(globalThis, 'AudioWorkletNode', saved); else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	});
	const original = await f.engine.getAudioContext({ resume: false });
	createNativePluginEffectNode(original, { params: { instanceId: 'automatic-rate-native' } });
	f.engine.loadProject(project(96_000));
	assert.equal((await f.engine.getAudioContext({ resume: false })) === original, true);
	assert.equal(f.contexts[0]!.closeCalls, 0);
	await assert.rejects(f.engine.getAudioContext({ resume: false, sampleRate: 96_000 }), /Remove native plug-in effects/u);
});

for (const pinned of [false, true]) test(`public Play honors a valid project filter with explicit clock=${pinned}`, async context => {
	const saved = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: MockAudioWorkletNode });
	const f = fixture();
	context.after(async () => {
		await f.engine.dispose();
		if (saved) Object.defineProperty(globalThis, 'AudioWorkletNode', saved); else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	});
	await f.engine.getAudioContext({ resume: false, ...(pinned ? { sampleRate: 44_100 } : {}) });
	f.engine.loadProject(project(96_000, true), new Map([['recording', new MockAudioBuffer(2, 4800, 96_000) as unknown as AudioBuffer]]));
	if (pinned) {
		await assert.rejects(f.engine.play(), /Nyquist/u);
		assert.equal(f.contexts[0]!.closeCalls, 0);
	} else {
		await f.engine.play();
		assert.equal(f.engine.getState().state, 'playing');
		assert.equal(f.contexts.at(-1)!.sampleRate, 96_000);
		await assert.rejects(f.engine.getAudioContext({ sampleRate: 48_000 }), /Stop playback/u);
		f.engine.stop();
	}
});

for (const action of ['play', 'scrub'] as const) test(`Stop retires ${action} ownership while an automatic context closes`, async context => {
	const saved = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: MockAudioWorkletNode });
	const f = fixture();
	context.after(async () => {
		await f.engine.dispose();
		if (saved) Object.defineProperty(globalThis, 'AudioWorkletNode', saved); else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	});
	await f.engine.getAudioContext({ resume: false });
	let finish!: () => void;
	f.contexts[0]!.closeBarrier = new Promise<void>(resolve => { finish = resolve; });
	f.engine.loadProject(project(96_000, true), new Map([['recording', new MockAudioBuffer(2, 4800, 96_000) as unknown as AudioBuffer]]));
	const operation = action === 'play' ? f.engine.play() : f.engine.scrub(100);
	f.engine.stop(); finish(); await operation;
	assert.notEqual(f.engine.getState().state, 'playing');
	assert.equal(f.contexts.flatMap(value => value.bufferSources).length, 0, 'retired requests cannot schedule an audible source');
});

test('disposal during automatic context construction closes its unadopted context', async () => {
	const contexts: DeviceContext[] = [];
	let dispose: (() => Promise<void>) | null = null;
	let disposed: Promise<void> | null = null;
	const engine = createAudioEditorEngine({ audioContextFactory: options => {
		const context = new DeviceContext(options); contexts.push(context);
		disposed = dispose?.() ?? null;
		return context as unknown as EngineAudioContext;
	} });
	dispose = () => engine.dispose();
	engine.loadProject(project(96_000));
	await assert.rejects(engine.getAudioContext({ resume: false }), /disposed/iu);
	await disposed;
	assert.equal(contexts.length, 1); assert.equal(contexts[0]!.closeCalls, 1);
});
