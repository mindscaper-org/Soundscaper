/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { createPlaybackPreviewEngines } from '../src/common/editor/controller/composition/internal/playback-preview-engines.ts';
import { createSoundscaperNativeAudioRenderer, soundscaperNativeAudioDestination } from '../src/common/editor/soundscaper-native-audio-renderer.ts';
import { deferred } from './helpers/async-test-control.ts';
import { setImmediate } from 'node:timers/promises';
import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';
import { MockAudioContext, MockNode } from './helpers/mock-audio-context.js';

const contextPort = (context: MockAudioContext): EngineAudioContext => context as unknown as EngineAudioContext;
function fixture() {
	let context = new MockAudioContext();
	let deviceId = 'native:alsa:audio-output:chosen';
	const main = createAudioEditorEngine({ audioContextFactory: () => contextPort(context) });
	const bus = new EventTarget();
	Object.defineProperty(bus, 'window', { value: bus });
	const renderer = createSoundscaperNativeAudioRenderer({ engine: main, windowValue: bus,
		createNode: async () => ({ node: context.createGain() as unknown as AudioNode,
			attach: (_port, config) => config.generation, revoke: () => 1, notifyPeerLoss: () => 1,
			calibrate: async () => 0, dispose() {} }) });
	const privateContexts: MockAudioContext[] = [];
	const factory: typeof createAudioEditorEngine = options => createAudioEditorEngine({ ...options,
		audioContextFactory: settings => { const audio = new MockAudioContext(settings); privateContexts.push(audio); return contextPort(audio); } });
	const pool = createPlaybackPreviewEngines(factory, () => .25, () => deviceId, {
		getAudioContext: () => main.getAudioContext({ resume: false }),
		createEngine: (lease, options) => factory({ ...options, realtimeContextLease: lease }),
	});
	async function attach(id = 'output') {
		await renderer.prepare(id, { candidates: [{ backend: 'alsa', deviceHandle: 'chosen' }], direction: 'output', mode: 'shared',
			sampleRate: context.sampleRate, periodFrames: 128, channelCount: 6 });
		bus.dispatchEvent(Object.assign(new Event('message'), { source: bus, data: { type: 'soundscaper-native-realtime-port-v1', offer: {
			sessionId: id, protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: context.sampleRate,
			channelCount: 6, frameCount: 128, queueCapacity: 8, startFrame: 0,
		} }, ports: [{ close() {} }] }));
		await renderer.waitForPort(id);
	}
	return { main, renderer, pool, attach, privateContexts, context: () => context,
		setDevice: (value: string) => { deviceId = value; },
		async replaceContext() { context = new MockAudioContext({ sampleRate: 96000 }); await main.getAudioContext({ resume: false, sampleRate: 96000 }); },
		async dispose() { await renderer.dispose(); await main.dispose(); } };
}

test('independent native auditions use the selected physical context and release only their lease', async context => {
	const f = fixture(); context.after(() => f.dispose());
	await f.attach();
	const preview = f.pool.create({});
	await f.pool.setOutput('native:alsa:audio-output:chosen');
	const audio = await preview.getAudioContext({ resume: false });
	assert.equal(audio, f.context());
	assert.equal(f.privateContexts.length, 0);
	const destination = preview.getPlaybackDestination();
	const physical = soundscaperNativeAudioDestination(audio, audio.destination);
	assert.notEqual(physical, audio.destination);
	assert.equal((destination as unknown as MockNode).connections[0], physical);
	assert.equal(preview.getPlaybackGain(), .25);
	await preview.dispose();
	assert.equal(f.context().state, 'running');
	assert.equal(await f.main.getAudioContext({ resume: false }), audio);
});

test('native context replacement rebinds an audition; browser fallback regains a private owned context', async context => {
	const f = fixture(); context.after(() => f.dispose());
	await f.attach();
	const preview = f.pool.create({});
	await f.pool.setOutput('native:alsa:audio-output:chosen');
	const old = await preview.getAudioContext({ resume: false });
	await f.renderer.release('output');
	await f.replaceContext();
	await f.attach('replacement');
	await f.pool.setOutput('native:alsa:audio-output:chosen');
	assert.equal(await preview.getAudioContext({ resume: false }), f.context());
	assert.notEqual(f.context(), old);
	f.setDevice('');
	await f.pool.setOutput('');
	const browser = await preview.getAudioContext({ resume: false });
	assert.notEqual(browser, f.context());
	assert.equal(f.privateContexts.length, 1);
	await preview.dispose();
	assert.equal(browser.state, 'closed');
	assert.equal(f.context().state, 'running');
});

test('disposing while a native output is preparing releases late admission without closing the owner', async context => {
	const f = fixture(); context.after(() => f.dispose());
	const gate = deferred<EngineAudioContext>();
	const pool = createPlaybackPreviewEngines(createAudioEditorEngine, () => 1, () => 'native:alsa:audio-output:chosen', {
		getAudioContext: () => gate.promise,
		createEngine: (lease, options) => createAudioEditorEngine({ ...options, realtimeContextLease: lease }),
	});
	const preview = pool.create({});
	const pending = Promise.allSettled([pool.setOutput('native:alsa:audio-output:chosen')]);
	await preview.dispose();
	gate.resolve(contextPort(f.context()));
	await pending;
	assert.equal(f.context().state, 'running');
});

test('Stop cancels a pending native audition before attachment without allocating browser output', async context => {
	const f = fixture(); context.after(() => f.dispose());
	const preview = f.pool.create({});
	preview.loadProject(createAudioPreviewProject({ sampleRate: 16000, sources: [], clips: [], tracks: [] }));
	const pending = preview.play();
	await setImmediate();
	preview.stop();
	await pending;
	assert.equal(preview.getState().state, 'stopped');
	assert.equal(f.privateContexts.length, 0);
	await preview.dispose();
	assert.equal(f.context().state, 'running');
});

test('a current native admission failure stays visible without falling back to another device', async context => {
	const f = fixture(); context.after(() => f.dispose());
	const failure = new DOMException('The native device was lost.', 'NotReadableError');
	const pool = createPlaybackPreviewEngines(createAudioEditorEngine, () => 1, () => 'native:alsa:audio-output:chosen', {
		getAudioContext: async () => { throw failure; },
		createEngine: (lease, options) => createAudioEditorEngine({ ...options, realtimeContextLease: lease }),
	});
	const preview = pool.create({});
	await assert.rejects(pool.setOutput('native:alsa:audio-output:chosen'), error => error === failure);
	await preview.dispose();
	assert.equal(f.context().state, 'running');
});

test('an active audition keeps its timeline position across native rate replacement after an elapsed main clock', async context => {
	const f = fixture(); context.after(() => f.dispose());
	await f.attach();
	f.context().currentTime = 37;
	const hardware = Object.assign(f.context().destination, { maxChannelCount: 6, channelCount: 6 });
	const preview = f.pool.create({});
	await f.pool.setOutput('native:alsa:audio-output:chosen');
	const frames = 32000, buffer = f.context().createBuffer(1, frames, 16000);
	buffer.getChannelData(0).fill(.25);
	preview.loadProject(createAudioPreviewProject({ sampleRate: 16000,
		sources: [{ id: 'source', sampleRate: 16000, frameCount: frames, channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: frames, sourceDurationFrames: frames }],
		tracks: [{ id: 'track', clipIds: ['clip'] }] }), new Map([['source', buffer as unknown as AudioBuffer]]));
	assert.equal(hardware.channelCount, 6, 'loading the mono preview must not reconfigure its owner hardware');
	await preview.play();
	assert.equal(preview.getState().state, 'playing');
	f.context().currentTime += .3;
	await f.renderer.release('output');
	await f.replaceContext();
	await f.attach('replacement');
	await f.pool.setOutput('native:alsa:audio-output:chosen');
	assert.equal(preview.getState().state, 'playing');
	assert.ok(preview.getState().positionFrame >= 3200 && preview.getState().positionFrame <= 6400);
	await f.renderer.release('replacement');
	await setImmediate();
	preview.pause();
	await f.attach('after-user-pause');
	await f.pool.setOutput('native:alsa:audio-output:chosen');
	assert.equal(preview.getState().state, 'paused', 'a user Pause must cancel automatic output resumption');
	await preview.dispose();
	assert.equal(f.context().state, 'running');
});
