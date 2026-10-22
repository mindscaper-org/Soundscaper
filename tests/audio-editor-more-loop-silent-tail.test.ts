/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController } from './helpers/audio-editor-controller-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

function document(warped = false) {
	const source = createAudioSource({ id: 'source', frameCount: 48_000, channelCount: 2, sampleRate: 48_000 });
	return createSoundscaperProject({ id: 'loop-silent-tail', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000,
			warpMap: warped ? { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' },
				{ outer: 48_000, source: 48_000, mode: 'forward' }] } : undefined })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
}

for (const mode of ['normal', 'naive', 'staffpad', 'exact-warp'] as const) {
	test(`${mode} playback keeps the silence selected after the final clip inside its loop`, async context => {
		const device = new MockAudioContext();
		const project = document(mode === 'exact-warp');
		const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext,
			offlineAudioContextFactory: options => new MockOfflineAudioContext(options) as unknown as OfflineAudioContext,
			audioWarpRealtimeAcceleration: false, meterInterval: 25 });
		context.after(async () => { await engine.dispose(); });
		engine.loadProject(project, new Map([['source', new MockAudioBuffer(2, 48_000, 48_000) as unknown as AudioBuffer]]));
		const loop = { enabled: true, startFrame: 0, endFrame: 96_000 };
		assert.deepEqual(engine.setLoop(loop), loop, 'the authored loop is bounded by the editor timeline, including its selected blank tail');
		const rate = mode === 'naive' || mode === 'staffpad' ? 1.25 : 1;
		if (mode === 'naive' || mode === 'staffpad') await engine.playAtSpeed(rate, { preservePitch: mode === 'staffpad',
			pitchPreserver: channels => Promise.resolve(channels.map(() => new Float32Array(38_400))) });
		else await engine.play();
		device.currentTime = 1.25 / rate;
		assert.equal(engine.getPositionFrames(), 60_000, 'the first iteration is still in its selected silence');
		device.currentTime = 1.8 / rate;
		await new Promise<void>(resolve => { setTimeout(resolve, 60); });
		for (let turn = 0; turn < 20; turn++) await Promise.resolve();
		if (mode === 'normal' || mode === 'naive' || mode === 'staffpad') {
			assert.ok(device.bufferSources.some(source => Math.abs(Number(source.started?.[0]) - 2 / rate) < .000001), 'the source repeats after the complete loop, including silence');
			if (mode === 'staffpad') assert.ok(device.bufferSources.every(source => source.buffer.length === 38_400), 'silent loop space never pads the whole prepared buffer');
		} else {
			assert.equal(device.bufferSources[0]!.buffer.length, 96_000, 'the bounded exact loop includes its silent ending');
			assert.equal(device.bufferSources[0]!.loop, true);
		}
		device.currentTime = 2.1 / rate;
		assert.ok(Math.abs(engine.getPositionFrames() - 4_800) <= 1, 'the playhead wraps at the authored loop boundary');
	});
}

test('a sample-scale StaffPad loop uses one bounded loop body instead of flooding the native scheduler', async context => {
	const device = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext,
		offlineAudioContextFactory: options => new MockOfflineAudioContext(options) as unknown as OfflineAudioContext });
	context.after(async () => { await engine.dispose(); });
	engine.loadProject(document(), new Map([['source', new MockAudioBuffer(2, 48_000, 48_000) as unknown as AudioBuffer]]));
	engine.setLoop({ enabled: true, startFrame: 47_999, endFrame: 48_001 });
	await engine.playAtSpeed(1.25, { preservePitch: true,
		pitchPreserver: channels => Promise.resolve(channels.map(() => new Float32Array(38_400))) });
	assert.equal(device.bufferSources.length, 1);
	assert.equal(device.bufferSources[0]!.loop, true, 'the native source owns a very short loop continuously');
	assert.ok(device.bufferSources[0]!.buffer.length <= 4, 'only the sample-scale loop body is copied');
});

test('a loop moved into the silent ending while StaffPad prepares starts at the current loop edge', async context => {
	const device = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext,
		offlineAudioContextFactory: options => new MockOfflineAudioContext(options) as unknown as OfflineAudioContext });
	context.after(async () => { await engine.dispose(); });
	engine.loadProject(document(), new Map([['source', new MockAudioBuffer(2, 48_000, 48_000) as unknown as AudioBuffer]]));
	let entered!: () => void; const preparing = new Promise<void>(resolve => { entered = resolve; });
	let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
	const playing = engine.playAtSpeed(1.25, { preservePitch: true, pitchPreserver: async channels => {
		entered(); await ready; return channels.map(() => new Float32Array(38_400));
	} });
	await preparing; engine.setLoop({ enabled: true, startFrame: 47_999, endFrame: 48_001 }); release(); await playing;
	assert.equal(engine.getPositionFrames(), 47_999);
	assert.equal(device.bufferSources[0]!.started?.[1], 0, 'the bounded loop source never receives a negative start offset');
});

for (const mode of ['staffpad', 'exact-warp'] as const) test(`${mode} loops can lie entirely in the selected blank timeline`, async context => {
	const device = new MockAudioContext(); let renders = 0;
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext,
		offlineAudioContextFactory: options => { renders++; return new MockOfflineAudioContext(options) as unknown as OfflineAudioContext; },
		audioWarpRealtimeAcceleration: false });
	context.after(async () => { await engine.dispose(); });
	engine.loadProject(document(mode === 'exact-warp'), new Map([['source', new MockAudioBuffer(2, 48_000, 48_000) as unknown as AudioBuffer]]));
	engine.setLoop({ enabled: true, startFrame: 72_000, endFrame: 96_000 });
	if (mode === 'staffpad') await engine.playAtSpeed(1, { preservePitch: true,
		pitchPreserver: channels => Promise.resolve(channels) });
	else await engine.play();
	assert.equal(engine.getState().state, 'playing'); assert.equal(engine.getPositionFrames(), 72_000);
	device.currentTime = .25; assert.equal(engine.getPositionFrames(), 84_000);
	device.currentTime = .6; assert.equal(engine.getPositionFrames(), 76_800);
	if (mode === 'exact-warp') {
		assert.equal(renders, 0, 'an entirely blank bounded window needs no offline audio render');
		assert.ok(device.bufferSources[0]!.buffer.getChannelData(0).every((sample: number) => sample === 0));
	}
});

test('Loop to selection then Play retains a menu-authored blank ending through controller project reloads', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const device = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext });
	const pcm = new MockAudioBuffer(2, 48_000, 48_000) as unknown as AudioBuffer;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const project = document(); const store = Object.assign(createMemoryStore(), {
		async loadSourceAudioBuffer() { return pcm; },
	});
	store.audioSources.set('source', [new Float32Array(48_000).fill(.25), new Float32Array(48_000).fill(.25)]);
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], engine });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
	controller.actions.timeline.setSelection(0, 96_000, { trackIds: ['track'] });
	controller.actions.transport.loopToSelection();
	// The next menu gesture occurs after the command's source-cache refresh.
	await new Promise<void>(resolve => { setTimeout(resolve, 0); });
	await controller.actions.transport.playPause();
	assert.deepEqual(controller.project!.loop, { enabled: true, startFrame: 0, endFrame: 96_000 });
	assert.equal(engine.getState().state, 'playing'); device.currentTime = 1.25;
	await controller.actions.transport.playStopSelect();
	assert.equal(controller.project!.selection!.startFrame, 60_000, 'the engine obeys the region published by the actual loop command');
});
