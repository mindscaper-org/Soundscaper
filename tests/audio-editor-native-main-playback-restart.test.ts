/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';
import { createSoundscaperNativeAudioRenderer } from '../src/common/editor/soundscaper-native-audio-renderer.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

for (const preservePitch of [false, true]) test(`native output replacement retains active 2x playback and its prepared pitch mode=${preservePitch}`, async () => {
	const f = fixture();
	let prepared = 0;
	try {
		await f.attach();
		await f.engine.playAtSpeed(2, { preservePitch, pitchPreserver: async channels => {
			prepared++; return channels.map(channel => new Float32Array(channel.length / 2));
		} });
		f.context.currentTime += .25;
		const position = f.engine.getPositionFrames();
		await f.replace();
		assert.equal(f.engine.getState().state, 'playing');
		assert.equal(f.engine.getState().playbackMode, preservePitch ? 'staffpad' : 'naive');
		assert.equal(f.engine.getState().playbackRate, 2);
		assert.equal(f.engine.getPositionFrames(), position, 'the native clock already has37seconds of elapsed time');
		assert.equal(prepared, preservePitch ? 1 : 0, 'an output-only refresh must retain the current prepared programme');
		assert.equal(f.context.bufferSources.at(-1)?.playbackRate.value, preservePitch ? 1 : 2);
	} finally { await f.dispose(); }
});

test('native output replacement keeps the exact selected playback end', async () => {
	const f = fixture();
	try {
		await f.attach(); f.engine.seek(24_000);
		f.engine.setPlayRange({ startFrame: 24_000, endFrame: 72_000 }); await f.engine.play();
		f.context.currentTime += .25;
		await f.replace();
		assert.equal(f.context.bufferSources.at(-1)?.started?.[2], .75, 'only the remaining selection may be scheduled');
		f.context.currentTime += 1;
		assert.equal(f.engine.getPositionFrames(), 72_000, 'programme after the range must never become audible');
	} finally { await f.dispose(); }
});

test('native output replacement retains reversed source and loop phase', async () => {
	const f = fixture(true);
	try {
		await f.attach(); f.engine.setLoop(true, 24_000, 96_000); f.engine.seek(48_000); await f.engine.play();
		f.context.currentTime += .125;
		const position = f.engine.getPositionFrames();
		const reversed = f.context.bufferSources[0]?.buffer;
		assert.ok(reversed); assert.ok(reversed.getChannelData(0)[0]! > .19);
		await f.replace();
		assert.equal(f.engine.getPositionFrames(), position);
		assert.deepEqual(f.engine.getState().loop, { enabled: true, startFrame: 24_000, endFrame: 96_000 });
		assert.equal(f.context.bufferSources.at(-1)?.buffer, reversed);
	} finally { await f.dispose(); }
});

test('native output replacement retains the joined cut-preview buffer', async () => {
	const f = fixture();
	try {
		await f.attach(); await f.engine.playCutPreview({ startFrame: 48_000, endFrame: 96_000 });
		f.context.currentTime += .25;
		const joined = f.context.bufferSources.at(-1)?.buffer, position = f.engine.getPositionFrames();
		await f.replace();
		assert.equal(f.engine.getState().cutPreview, true);
		assert.equal(f.engine.getPositionFrames(), position);
		assert.equal(f.context.bufferSources.at(-1)?.buffer, joined);
	} finally { await f.dispose(); }
});

for (const during of [false, true]) for (const state of ['paused', 'stopped'] as const) test(`native route replacement cannot resume a user-${state} transport, during=${during}`, async () => {
	const f = fixture();
	try {
		await f.attach(); await f.engine.play();
		const replacing = during ? f.replace() : null;
		if (state === 'paused') f.engine.pause(); else f.engine.stop();
		const sources = f.context.bufferSources.length;
		await (replacing ?? f.replace());
		assert.equal(f.engine.getState().state, state);
		assert.equal(f.context.bufferSources.length, sources);
	} finally { await f.dispose(); }
});

function fixture(reversed = false) {
	const context = new MockAudioContext(); context.currentTime = 37;
	// The established Web Audio test double supplies the engine's browser-resource boundary.
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext });
	const frames = 48_000 * 12;
	const buffer = new MockAudioBuffer(1, frames, 48_000);
	for (let index = 0; index < frames; index++) buffer.getChannelData(0)[index] = index / frames * .2;
	engine.loadProject(createAudioPreviewProject({ sampleRate: 48_000,
		sources: [{ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: frames }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, durationFrames: frames,
			sourceStartFrame: 0, sourceDurationFrames: frames, reversed }],
		tracks: [{ id: 'track', clipIds: ['clip'] }],
	}), new Map([['source', buffer as unknown as AudioBuffer]]));
	engine.renderMix = async (options = {}) => new MockAudioBuffer(1,
		Number(options.endFrame ?? frames) - Number(options.startFrame ?? 0), 48_000) as unknown as AudioBuffer;
	const bus = new EventTarget(); Object.defineProperty(bus, 'window', { value: bus });
	const renderer = createSoundscaperNativeAudioRenderer({ engine, windowValue: bus,
		createNode: async () => ({ node: context.createGain() as unknown as AudioNode,
			attach: (_port, config) => config.generation, revoke: () => 1, notifyPeerLoss: () => 1,
			calibrate: async () => 0, dispose() {} }),
	});
	let current = '';
	async function attach(id = 'first') {
		current = id;
		await renderer.prepare(id, { candidates: [{ backend: 'alsa', deviceHandle: 'speakers' }],
			direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 128, channelCount: 2 });
		bus.dispatchEvent(Object.assign(new Event('message'), { source: bus, data: { type: 'soundscaper-native-realtime-port-v1', offer: {
			sessionId: id, protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: 48_000,
			channelCount: 2, frameCount: 128, queueCapacity: 8, startFrame: 0,
		} }, ports: [{ close() {} }] }));
		await renderer.waitForPort(id); await setImmediate();
	}
	return { engine, context, attach,
		replace: async () => { await renderer.release(current); await attach('replacement'); },
		dispose: async () => { engine.stop(); await renderer.dispose(); await engine.dispose(); },
	};
}
