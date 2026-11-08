/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { clockedPlaybackStartLeadSeconds } from '../src/common/editor/recording-start-lead.ts';
import { MidiPreviewContext, midiPreviewEngine } from './helpers/midi-preview-context.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

function fixture(t: TestContext) {
	const context = new MidiPreviewContext(), engine = midiPreviewEngine(context);
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const clip = { ...createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount }),
		timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount };
	const project = { ...createSoundscaperProject({ id: 'play-intent', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] }), clips: [clip] };
	const samples = new Float32Array(source.frameCount);
	const buffer: AudioBuffer = { sampleRate: source.sampleRate, length: samples.length, numberOfChannels: 1, duration: 1,
		getChannelData: () => samples,
		copyFromChannel: (destination, _channel, start = 0) => { destination.set(samples.subarray(start, start + destination.length)); },
		copyToChannel: (input, _channel, start = 0) => { samples.set(input, start); } };
	const buffers = new Map([[source.id, buffer]]);
	engine.loadProject(project, buffers);
	t.after(async () => { await engine.dispose(); });
	return { context, engine, project, buffers };
}

for (const action of ['stop', 'pause', 'seek', 'load'] as const) test(`${action} retires a pending Play before a later document refresh`, async t => {
	const f = fixture(t), entered = deferred<void>(), ready = deferred<void>();
	f.context.resume = async () => { entered.resolve(); await ready.promise; f.context.state = 'running'; };
	t.after(() => { ready.resolve(); });
	const pending = f.engine.play(); await entered.promise;
	const next = { ...f.project, master: { ...f.project.master, gain: .9 }, ...(action === 'load' ? { id: 'replacement' } : {}) };
	if (action === 'load') f.engine.loadProject(next, f.buffers);
	else if (action === 'seek') f.engine.seek(24_000);
	else f.engine[action]();
	const refreshed = f.engine.applyProject(next, f.buffers);
	ready.resolve(); await Promise.all([pending, refreshed]); await settle();
	assert.equal(f.engine.getState().state, 'stopped');
	assert.equal(f.context.bufferSources.length, 0, 'the retired request cannot allocate or start programme audio');
});

test('an uncancelled source refresh retains its current pending Play', async t => {
	const f = fixture(t), entered = deferred<void>(), ready = deferred<void>();
	f.context.resume = async () => { entered.resolve(); await ready.promise; f.context.state = 'running'; };
	t.after(() => { ready.resolve(); });
	const pending = f.engine.play(); await entered.promise;
	const refreshed = f.engine.applyProject({ ...f.project }, f.buffers);
	ready.resolve(); await Promise.all([pending, refreshed]);
	assert.equal(f.engine.getState().state, 'playing');
	assert.equal(f.context.bufferSources.length, 1);
});

test('completion of a stopped request cannot erase a newer clocked Play', async t => {
	const f = fixture(t), firstReady = deferred<void>(), nextReady = deferred<void>();
	let resumes = 0;
	f.context.resume = async () => { await (resumes++ === 0 ? firstReady.promise : nextReady.promise); f.context.state = 'running'; };
	t.after(() => { firstReady.resolve(); nextReady.resolve(); });
	const first = f.engine.play(); await waitFor(() => resumes === 1, 'the first pending Play');
	f.engine.stop();
	const second = f.engine.play({ clockedStart: true }); await waitFor(() => resumes === 2, 'the new pending Play');
	firstReady.resolve(); await first;
	const refreshed = f.engine.applyProject({ ...f.project }, f.buffers);
	await waitFor(() => resumes === 3, 'the current request reissued after refresh');
	nextReady.resolve(); await Promise.all([second, refreshed]);
	assert.equal(f.engine.getState().state, 'playing');
	assert.equal(f.context.bufferSources.length, 1);
	assert.equal(f.engine.getPlaybackAudibleStartTime(), clockedPlaybackStartLeadSeconds(false));
});

for (const action of ['stop', 'pause', 'seek', 'load'] as const) test(`${action} also retires a later startup rejection`, async t => {
	const f = fixture(t), entered = deferred<void>(), ready = deferred<void>();
	f.context.resume = async () => { entered.resolve(); await ready.promise; };
	t.after(() => { ready.resolve(); });
	const pending = f.engine.play(), result = Promise.allSettled([pending]); await entered.promise;
	if (action === 'load') f.engine.loadProject({ ...f.project, id: 'replacement' }, f.buffers);
	else if (action === 'seek') f.engine.seek(24_000);
	else f.engine[action]();
	ready.reject(new Error('The retired audio readiness failed.'));
	assert.equal((await result)[0]?.status, 'fulfilled', 'a retired request cannot publish its failure into the current editor');
	assert.equal(f.engine.getState().state, 'stopped');
	assert.equal(f.context.bufferSources.length, 0);
});

test('current startup failures still reject and permit a later explicit retry', async t => {
	const f = fixture(t), entered = deferred<void>(), ready = deferred<void>();
	const error = new Error('The current audio readiness failed.');
	f.context.resume = async () => { entered.resolve(); await ready.promise; };
	t.after(() => { ready.resolve(); });
	const pending = f.engine.play(), failure = assert.rejects(pending, error); await entered.promise;
	ready.reject(error); await failure;
	f.context.resume = async () => { f.context.state = 'running'; };
	await f.engine.play();
	assert.equal(f.engine.getState().state, 'playing'); assert.equal(f.context.bufferSources.length, 1);
});

test('a stopped request failure cannot interrupt or report over a newer successful Play', async t => {
	const f = fixture(t), ready = deferred<void>();
	let resumes = 0;
	f.context.resume = async () => { if (resumes++ === 0) await ready.promise; f.context.state = 'running'; };
	t.after(() => { ready.resolve(); });
	const first = f.engine.play(), result = Promise.allSettled([first]);
	await waitFor(() => resumes === 1, 'the old pending Play');
	f.engine.stop(); await f.engine.play({ clockedStart: true });
	ready.reject(new Error('The retired audio readiness failed.'));
	assert.equal((await result)[0]?.status, 'fulfilled');
	assert.equal(f.engine.getState().state, 'playing'); assert.equal(f.context.bufferSources.length, 1);
	assert.equal(f.engine.getPlaybackAudibleStartTime(), clockedPlaybackStartLeadSeconds(false));
});
