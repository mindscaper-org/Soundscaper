/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createClipTimePitchCacheService, type ClipTimePitchPreparationState } from '../src/common/editor/controller/source/clip-time-pitch-service.ts';
import { createOwnedStateAccess } from '../src/common/editor/controller/shared/owned-state.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { processedSpectrogramPreparation } from '../src/common/editor/controller/source/internal/processed-spectrogram-pcm.ts';
import { clipTimePitchPlaybackProjection } from '../src/common/editor/clip-time-pitch-playback-projection.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { deriveClipTimePitchCachePlan } from '../src/common/editor/clip-time-pitch-cache-plan.js';

function document(bpm: number, pitchCents = 1200) {
	const tempoMap = { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: bpm, den: 1 } }] };
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		anchor: 'musical', musicalStartBeat: 0, musicalExtent: 'beat', musicalDurationBeats: 2,
		pitchCents, speedRatio: 1, linkPitchAndTempo: false }, { projectSampleRate: 48_000, tempoMap });
	return createSoundscaperProject({ id: 'musical-pitch', tempoMap, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })] });
}

function cacheService(project: ReturnType<typeof document>) {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const state: ClipTimePitchPreparationState = { playbackCacheAbort: null, playbackCacheGeneration: 0, playbackCacheRefreshAbort: null };
	const unavailable = () => { throw new Error('No PCM acquisition is needed for cache admission.'); };
	return createClipTimePitchCacheService({ lifetime, state: { recordingStarting: false, recorder: null },
		playbackCacheState: createOwnedStateAccess(state, state),
		cache: { prepareCommittedOutput: unavailable, resolveForPlayback: unavailable, loadCommittedChannels: unavailable },
		sourceResolver: null, sourceChunkProviders: new Map(), getProject: () => project,
		captureProject: id => generation.capture(id), assertProject: token => generation.assertCurrent(token),
		createBufferFromChannels: unavailable, createRenderEngine: unavailable, applyProjectToPlaybackEngine: unavailable,
		getPlaybackState: () => 'paused', handleError: unavailable });
}

for (const bpm of [60, 120, 240]) test(`musical ${bpm}bpm cache admission follows resolved programme duration`, () => {
	const project = document(bpm);
	const before = JSON.stringify(project);
	const [pair] = cacheService(project).projectTimePitchPairs(project);
	assert.ok(pair);
	assert.equal(pair.clip.speedRatio, bpm / 120);
	assert.equal(pair.clip.durationFrames, 48_000 * 120 / bpm);
	assert.equal(pair.clip.sourceDurationFrames, 48_000);
	assert.equal(JSON.stringify(project), before, 'cache coordinates cannot rewrite canonical clip speed or source extent');
});

test('a tempo change alone prepares independent stretch even when authored pitch and speed are neutral', () => {
	const project = document(240, 0);
	const [pair] = cacheService(project).projectTimePitchPairs(project);
	assert.ok(pair, 'beat extent requires a stretch cache rather than native pitch-changing rate');
	assert.equal(pair.clip.speedRatio, 2);
	assert.equal(cacheService(document(120, 0)).projectHasTimePitchClips(document(120, 0)), false);
});

test('engine source resolution uses the same effective musical rate as cache preparation', async context => {
	const project = document(240);
	const before = JSON.stringify(project);
	const device = new MockAudioContext();
	const rates: unknown[] = [];
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext,
		sourceResolver: (clip: Readonly<Record<string, unknown>>) => { rates.push(clip.speedRatio); return null; } });
	context.after(async () => { await engine.dispose(); });
	engine.loadProject(project, new Map([['source', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer]]));
	await engine.play();
	assert.ok(rates.length > 0);
	assert.ok(rates.every(rate => rate === 2), 'prepared cache selection and scheduler must agree on the tempo-derived rate');
	assert.equal(JSON.stringify(project), before);
});

test('processed spectrogram preparation acquires the same tempo-derived cache', async () => {
	const project = document(240, 0), clip = project.clips[0]!, source = project.sources[0]!;
	const rates: unknown[] = [];
	const prepare = processedSpectrogramPreparation({ getProject: () => project, captureAuthority: () => () => {},
		cache: { async prepareCommittedOutput(actual) { rates.push(actual.speedRatio); return { cacheKey: 'musical', sampleRate: 48_000 }; } },
		open: () => ({ frameCount: 24_000, async readWindow(start, end) {
			return { startFrame: start, endFrame: end, channels: [new Float32Array(end - start)] };
		}, dispose() {} }) }, project, clip, source);
	assert.ok(prepare);
	const pcm = await prepare(new AbortController().signal);
	assert.deepEqual(rates, [2]);
	assert.equal(pcm.frameCount, 24_000);
	await pcm.dispose();
});

test('scalar projection respects source clocks and leaves other timing owners untouched', () => {
	const project = document(240), clip = project.clips[0]!;
	const halfRate = clipTimePitchPlaybackProjection(project, { ...clip, sourceDurationFrames: 24_000 }, { sampleRate: 24_000 });
	assert.equal(halfRate.speedRatio, 2);
	for (const other of [{ ...clip, anchor: 'samples' }, { ...clip, musicalExtent: 'seconds' },
		{ ...clip, linkPitchAndTempo: true }, { ...clip, warpMap: { points: [] } },
		{ ...clip, opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 48_000, offsetFrames: 0 } } }]) {
		assert.equal(clipTimePitchPlaybackProjection(project, other, { sampleRate: 48_000 }), other);
	}
	assert.equal(resolveRuntimeClipProjection(project, clip).speedRatio, 1, 'general command geometry retains authored speed');
});

test('tempo-derived rate changes cache identity and output length without changing source custody', async () => {
	const base = document(120), faster = document(240);
	const describe = async (project: ReturnType<typeof document>) => {
		const [pair] = cacheService(project).projectTimePitchPairs(project); assert.ok(pair);
		return deriveClipTimePitchCachePlan(pair.clip, pair.source, { projectSampleRate: 48_000 });
	};
	const first = await describe(base), second = await describe(faster);
	assert.notEqual(first.finalKey, second.finalKey);
	assert.equal(first.outputFrames, 48_000); assert.equal(second.outputFrames, 24_000);
	assert.deepEqual(first.sourceIdentity, second.sourceIdentity);
	assert.deepEqual(first.sourceRange, second.sourceRange);
});
