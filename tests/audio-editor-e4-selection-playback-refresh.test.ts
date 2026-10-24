/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { createProject } from './helpers/audio-editor-runtime-harness.js';
import { playbackFrequencyRange } from '../src/common/editor/engine/playback-frequency-range.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { deferred } from './helpers/async-test-control.ts';

function fixture() {
	const context = new MockAudioContext();
	const base = createProject();
	const project = { ...base, tracks: base.tracks.map(track => ({ ...track, effects: [] })), master: { gain: 1, effects: [] } };
	const sources = new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer]]);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext, meterInterval: 1000 });
	return { context, project, sources, engine };
}

for (const spectral of [false, true]) test(`reapplying an edited project preserves the active ${spectral ? 'spectral' : 'time'} audition end`, async () => {
	const { context, project, sources, engine } = fixture();
	try {
		engine.loadProject(project, sources);
		engine.setPlayRange({ startFrame: 12_000, endFrame: 36_000 });
		engine.seek(12_000);
		if (spectral) engine.setPlaybackFrequencyRange({ minimumFrequency: 500, maximumFrequency: 2000 });
		await engine.play();
		context.currentTime = .1;
		await engine.applyProject({ ...project, title: 'Edited while auditioning' }, sources);
		const started = context.bufferSources.at(-1)!.started;
		assert.equal(engine.getState().state, 'playing');
		assert.deepEqual(playbackFrequencyRange(engine as unknown as EngineRuntimeHost),
			spectral ? { minimumFrequency: 500, maximumFrequency: 2000 } : null);
		assert.ok(Math.abs(started[1]! + started[2]! - .75) < 1 / 48_000,
			`rescheduled programme ends at ${started[1]! + started[2]!} rather than selected .75s`);
	} finally { await engine.dispose(); }
});

test('a pending bounded Play retains its request through a source refresh', async () => {
	const { context, project, sources, engine } = fixture();
	const resume = deferred<void>();
	const entered = deferred<void>();
	context.resume = () => { entered.resolve(); return resume.promise; };
	try {
		engine.loadProject(project, sources);
		engine.setPlayRange({ startFrame: 0, endFrame: 24_000 });
		engine.setPlaybackFrequencyRange({ minimumFrequency: 500, maximumFrequency: 2000 });
		const pending = engine.play(); await entered.promise;
		const refreshed = engine.applyProject({ ...project, title: 'Source cache ready' }, sources);
		resume.resolve(); await Promise.all([pending, refreshed]);
		assert.equal(context.bufferSources.length, 1);
		assert.equal(context.bufferSources[0]!.started[2], .5);
		assert.deepEqual(playbackFrequencyRange(engine as unknown as EngineRuntimeHost), { minimumFrequency: 500, maximumFrequency: 2000 });
	} finally { resume.resolve(); await engine.dispose(); }
});

for (const retire of ['stop', 'pause', 'activate'] as const) test(`${retire} still retires audition before a later project refresh`, async () => {
	const { engine, project, sources, context } = fixture();
	try {
		engine.loadProject(project, sources);
		engine.setPlayRange({ startFrame: 0, endFrame: 24_000 });
		engine.setPlaybackFrequencyRange({ minimumFrequency: 500, maximumFrequency: 2000 });
		await engine.play();
		if (retire === 'activate') engine.loadProject({ ...project, id: 'incoming' }, sources);
		else engine[retire]();
		await engine.applyProject({ ...project, id: retire === 'activate' ? 'incoming' : project.id }, sources);
		assert.notEqual(engine.getState().state, 'playing');
		assert.equal(playbackFrequencyRange(engine as unknown as EngineRuntimeHost), null);
		await engine.play();
		const started = context.bufferSources.at(-1)!.started;
		assert.equal(started[1]! + started[2]!, 1);
	} finally { await engine.dispose(); }
});

test('an edit at an already reached audition end cannot restart the remaining programme', async () => {
	const { engine, project, sources, context } = fixture();
	try {
		engine.loadProject(project, sources);
		engine.setPlayRange({ startFrame: 0, endFrame: 24_000 });
		await engine.play(); context.currentTime = .6;
		const count = context.bufferSources.length;
		await engine.applyProject({ ...project, title: 'Edit at the audio boundary' }, sources);
		assert.equal(context.bufferSources.length, count);
		assert.equal(engine.getState().state, 'stopped');
		assert.equal(engine.getPositionFrames(), 24_000);
	} finally { await engine.dispose(); }
});

test('an edit retires a cached cut audition without starting the excluded programme', async () => {
	const { engine, project, sources, context } = fixture();
	engine.renderMix = async (options = {}) => new MockAudioBuffer(1,
		Number(options.endFrame) - Number(options.startFrame), 48_000) as unknown as AudioBuffer;
	try {
		engine.loadProject(project, sources);
		await engine.playCutPreview({ startFrame: 12_000, endFrame: 24_000 });
		assert.equal(engine.getState().cutPreview, true);
		context.currentTime = .1;
		const cursor = engine.getPositionFrames();
		const count = context.bufferSources.length;
		await engine.applyProject({ ...project, title: 'Edited during cut audition' }, sources);
		assert.equal(engine.getState().state, 'stopped');
		assert.equal(engine.getState().cutPreview, false);
		assert.equal(engine.getPositionFrames(), cursor);
		assert.equal(context.bufferSources.length, count, 'the excluded gap cannot become ordinary playback');
		await engine.play();
		assert.equal(context.bufferSources.at(-1)!.buffer?.length, 48_000, 'an explicit Play can start the current programme');
	} finally { await engine.dispose(); }
});
