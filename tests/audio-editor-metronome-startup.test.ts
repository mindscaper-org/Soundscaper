/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createEditorTransportService } from '../src/common/editor/controller/transport/internal/transport-service.ts';
import { calculateAudioEditorMetronomeSchedule } from '../src/common/editor/controller/transport/transport-model.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { clockedPlaybackStartLeadSeconds } from '../src/common/editor/recording-start-lead.ts';
import { createTransportFixture } from './helpers/audio-editor-transport-fixture.ts';
import { MidiPreviewContext, midiPreviewEngine } from './helpers/midi-preview-context.ts';
import { MockNode, MockParam } from './helpers/mock-audio-context.js';
import { deferred, settle } from './helpers/async-test-control.ts';

class ClickParam extends MockParam {
	exponentialRampToValueAtTime(value: number, time: number): void { this.linearRampToValueAtTime(value, time); }
}
class ClickContext extends MidiPreviewContext {
	readonly starts: number[] = [];
	readonly stops: (number | undefined)[] = [];
	createGain() { return Object.assign(super.createGain(), { gain: new ClickParam(1) }); }
	createOscillator() {
		return Object.assign(new MockNode('oscillator'), { frequency: new MockParam(), onended: null,
			start: (when: number) => { this.starts.push(when); }, stop: (when?: number) => { this.stops.push(when); } });
	}
}

async function fixture(t: TestContext, { enabled = true, fromFrame = 0, clockStep = .01, loop = false } = {}) {
	const base = createTransportFixture(), context = new ClickContext(), engine = midiPreviewEngine(context);
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 96_000 });
	const clip = { ...createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 96_000, sourceDurationFrames: 96_000 }),
		timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 96_000, sourceDurationFrames: 96_000 };
	const project = createSoundscaperProject({ id: 'metronome-startup', sampleRate: 48_000, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })],
		loop: { enabled: loop, startFrame: 0, endFrame: 19_200 },
		selection: { startFrame: fromFrame, endFrame: 19_200, trackIds: ['track'], clipIds: [] } });
	const samples = new Float32Array(source.frameCount);
	const buffer: AudioBuffer = { sampleRate: 48_000, length: samples.length, numberOfChannels: 1, duration: 2,
		getChannelData: () => samples,
		copyFromChannel: (destination, _channel, start = 0) => { destination.set(samples.subarray(start, start + destination.length)); },
		copyToChannel: (input, _channel, start = 0) => { samples.set(input, start); } };
	engine.loadProject({ ...project, clips: [clip] }, new Map([[source.id, buffer]]));
	engine.seek(fromFrame);
	base.state.metronomeEnabled = enabled;
	const service = createEditorTransportService({ ...base.runtime, engine, getProject: () => project,
		activeSelection: () => project.selection, calculateAudioEditorMetronomeSchedule });
	const unsubscribe = engine.subscribeState(state => {
		base.state.transportState = state;
		if (state === 'playing') context.currentTime += clockStep;
		service.syncMetronome();
	});
	t.after(async () => { unsubscribe(); service.stopMetronome(); await engine.dispose(); });
	return { context, engine, service, project, base, buffer, clip, source };
}

for (const action of ['play', 'play-selection'] as const) test(`enabled ${action} queues the initial pulse before audible source frame zero`, async t => {
	const f = await fixture(t); await f.service.handleTransport(action); await settle(4);
	assert.deepEqual(f.context.starts, [f.engine.getPlaybackAudibleStartTime()]);
	assert.ok(f.context.starts[0]! > f.context.currentTime);
	assert.equal(f.context.starts[0], clockedPlaybackStartLeadSeconds(false));
});

test('enabled double-speed startup retains the same real-time coordination lead', async t => {
	const f = await fixture(t); await f.service.handlePlayAtSpeed(2); await settle(4);
	assert.deepEqual(f.context.starts, [f.engine.getPlaybackAudibleStartTime()]);
	assert.equal(f.context.starts[0], clockedPlaybackStartLeadSeconds(false));
	assert.equal(f.engine.getState().playbackRate, 2);
});

test('disabled metronome preserves the ordinary immediate-start latency', async t => {
	const f = await fixture(t, { enabled: false }); await f.service.handleTransport('play'); await settle(4);
	assert.equal(f.engine.getPlaybackAudibleStartTime(), 0); assert.deepEqual(f.context.starts, []);
});

test('starting between beats does not invent an initial downbeat', async t => {
	const f = await fixture(t, { fromFrame: 12_000 }); await f.service.handleTransport('play-selection'); await settle(4);
	assert.deepEqual(f.context.starts, []);
});

test('Stop cancels the already queued initial click', async t => {
	const f = await fixture(t); await f.service.handleTransport('play'); await settle(4);
	assert.equal(f.context.starts.length, 1); await f.service.handleTransport('stop');
	assert.ok(f.context.stops.includes(undefined));
});

test('an observer genuinely later than the coordination lead still drops the missed pulse', async t => {
	const f = await fixture(t, { clockStep: .3 }); await f.service.handleTransport('play-selection'); await settle(4);
	assert.deepEqual(f.context.starts, []);
});

test('source refresh reissues a pending clocked Play with its coordination lead intact', async t => {
	const f = await fixture(t), entered = deferred<void>(), ready = deferred<void>();
	let resumes = 0;
	f.context.resume = async () => { if (resumes++ === 0) { entered.resolve(); await ready.promise; } f.context.state = 'running'; };
	t.after(() => { ready.resolve(); });
	const pending = f.service.handleTransport('play'); await entered.promise;
	await f.engine.applyProject({ ...f.project, clips: [f.clip] }, new Map([[f.source.id, f.buffer]]));
	ready.resolve(); await pending; await settle(4);
	assert.deepEqual(f.context.starts, [clockedPlaybackStartLeadSeconds(false)]);
	assert.equal(f.context.bufferSources.length, 1, 'only the refreshed project owns a source start');
});

test('clock coordination begins after delayed AudioContext readiness', async t => {
	const f = await fixture(t);
	f.context.resume = async () => { f.context.currentTime = 50; f.context.state = 'running'; };
	await f.service.handleTransport('play'); await settle(4);
	assert.deepEqual(f.context.starts, [50 + clockedPlaybackStartLeadSeconds(false)]);
});

test('enabling the metronome during playback does not restart or delay the programme', async t => {
	const f = await fixture(t, { enabled: false }); await f.service.handleTransport('play'); await settle(4);
	const origin = f.engine.getPlaybackAudibleStartTime(), sources = f.context.bufferSources.length;
	f.context.currentTime = .4; f.service.toggleMetronome(); await settle(4);
	assert.equal(f.engine.getPlaybackAudibleStartTime(), origin); assert.equal(f.context.bufferSources.length, sources);
	assert.deepEqual(f.context.starts, [.5]);
});

test('pitch-preserving speed playback uses the same primed clock boundary', async t => {
	const f = await fixture(t);
	f.engine.renderMix = async () => f.buffer;
	await f.engine.playAtSpeed(2, { clockedStart: true, preservePitch: true,
		pitchPreserver: async channels => channels.map(channel => channel.slice(0, channel.length / 2)) });
	await settle(4);
	assert.equal(f.engine.getState().playbackMode, 'staffpad');
	assert.deepEqual(f.context.starts, [f.engine.getPlaybackAudibleStartTime()]);
	assert.equal(f.context.starts[0], clockedPlaybackStartLeadSeconds(false));
});

test('the initial coordination lead does not shift the loop wrap phase', async t => {
	const f = await fixture(t, { loop: true }); await f.service.handleTransport('play'); await settle(4);
	f.context.currentTime = .4; await f.service.runMetronomeScheduler();
	const origin = clockedPlaybackStartLeadSeconds(false);
	assert.deepEqual(f.context.starts, [origin, origin + .4]);
});
