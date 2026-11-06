/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createClipSourcePreviewService } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import { createProjectBinPreviewService } from '../src/common/editor/controller/import/internal/project-bin/project-bin-preview-service.ts';
import type { ProjectBinPreview } from '../src/common/editor/controller/import/project-bin-types.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { MidiPreviewContext, midiPreviewEngine } from './helpers/midi-preview-context.ts';
import { waitFor } from './helpers/async-test-control.ts';

function fixture(t: TestContext, { trimmed = false, musical = false, secondItem = false } = {}) {
	const context = new MidiPreviewContext(), engine = midiPreviewEngine(context);
	const lifetime = new EditorControllerLifetime(), generation = new EditorProjectGeneration();
	const sourceRate = trimmed ? 24_000 : 48_000;
	const source = { ...createAudioSource({ id: 'source', sampleRate: sourceRate, channelCount: 1, frameCount: sourceRate }) };
	const sourceStartFrame = trimmed ? 6_000 : 0, sourceDurationFrames = trimmed ? 12_000 : 48_000;
	const clip = { ...createAudioClip({ id: 'clip', sourceId: source.id, anchor: 'sample',
		timelineStartFrame: 96_000, durationFrames: 48_000, sourceStartFrame, sourceDurationFrames }),
		timelineStartFrame: 96_000, durationFrames: 48_000, sourceStartFrame, sourceDurationFrames };
	const document = createSoundscaperProject({ id: 'audition-boundary', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const project = { ...document, clips: [clip], sources: [source] };
	const samples = new Float32Array(sourceRate).fill(.1);
	const buffer: AudioBuffer = {
		sampleRate: sourceRate, length: sourceRate, numberOfChannels: 1, duration: 1,
		getChannelData: () => samples,
		copyFromChannel: (output, _channel, start = 0) => { output.set(samples.subarray(start, start + output.length)); },
		copyToChannel: (input, _channel, start = 0) => { samples.set(input, start); },
	};
	const buffers = new Map([[source.id, buffer]]);
	generation.activate(project.id);
	const captureProject = () => generation.capture();
	const assertProject = (token: ReturnType<typeof captureProject>) => generation.assertCurrent(token);
	const sourcePreview = createClipSourcePreviewService({
		lifetime, getProject: () => project, captureProject, assertProject,
		handleError: error => { throw error; },
		resources: {
			sourceBuffers: buffers, sourceChunkProviders: new Map(), prepare: async () => {},
			retirePlayback() {}, subscribeTimelineState: () => () => {},
			createEngine: ({ onState }) => { engine.subscribeState(onState); return engine; },
		},
	});
	let binPreview: ProjectBinPreview | null = null;
	const binClip = musical ? { ...clip, anchor: 'musical' as const, musicalExtent: 'beat' as const,
		musicalStartBeat: { num: 4, den: 1 }, musicalDurationBeats: { num: 2, den: 1 }, durationFrames: undefined } : clip;
	const binClips = [{ ...binClip, binItemId: 'first-item' }, ...(secondItem
		? [{ ...clip, id: 'second', binItemId: 'second-item', durationFrames: 14_400, sourceDurationFrames: 14_400 }] : [])];
	const binProject = { ...project, clips: [], projectBin: { clips: binClips } };
	const bin = createProjectBinPreviewService({
		lifetime, copy: { audioClipNotFound: 'Missing clip', localSourcesMissing: 'Missing source' },
		retireTimelinePlayback() {}, sourceBuffers: buffers, sourceChunkProviders: new Map(),
		createPreviewEngine: ({ onState }) => { engine.subscribeState(onState); return engine; },
		createId: prefix => `${prefix}-preview`, getProject: () => binProject, captureProject, assertProject,
		getPreview: () => binPreview, setPreview: preview => { binPreview = preview; },
		isSourceMissing: () => false, getVisualData: () => null, publish() {},
	});
	t.after(async () => {
		await sourcePreview.dispose();
		await bin.stopProjectBinPreview({ dispose: true });
		await engine.dispose();
		lifetime.beginDisposal(); lifetime.finishDisposal();
	});
	return { context, engine, sourcePreview, bin, preview: () => binPreview };
}

for (const trimmed of [false, true]) {
	test(`full Source ends at its ${trimmed ? 'processed 24k' : 'plain'} asset extent`, async t => {
		const f = fixture(t, { trimmed });
		await f.sourcePreview.playPause('clip');
		const end = trimmed ? 72_000 : 48_000;
		assert.equal(f.sourcePreview.snapshot().durationFrames, end);
		assert.equal(f.engine.getState().playbackEndFrame, end);
		const start = f.engine.getPlaybackAudibleStartTime();
		assert.ok(start !== null);
		f.context.currentTime = start + end / 48_000 + .01;
		await waitFor(() => f.sourcePreview.snapshot().state === 'stopped', 'full Source terminal state');
		assert.equal(f.sourcePreview.snapshot().positionFrame, end);
		await f.sourcePreview.playPause('clip');
		assert.equal(f.engine.getPositionFrames(), 0, 'replay starts at the asset origin');
	});
}

test('an explicit Source selection remains bounded and resumes at the user Pause position', async t => {
	const f = fixture(t);
	f.sourcePreview.focus('clip');
	f.sourcePreview.setSelection({ startFrame: 4_800, endFrame: 38_400 });
	await f.sourcePreview.playPause('clip');
	assert.equal(f.engine.getState().playbackEndFrame, 38_400);
	f.context.currentTime += .2;
	await f.sourcePreview.playPause('clip');
	const pausedPosition = f.engine.getPositionFrames();
	await f.sourcePreview.playPause('clip');
	assert.equal(f.engine.getPositionFrames(), pausedPosition);
	assert.equal(f.engine.getState().playbackEndFrame, 38_400);
});

test('an explicit full Source loop retains its loop transport', async t => {
	const f = fixture(t);
	f.sourcePreview.focus('clip');
	f.sourcePreview.setLoop(true);
	await f.sourcePreview.playPause('clip');
	assert.deepEqual(f.engine.getState().loop, { enabled: true, startFrame: 0, endFrame: 48_000 });
	f.context.currentTime += 1.2;
	assert.equal(f.engine.getState().state, 'playing');
});

for (const trimmed of [false, true]) {
	test(`Bin ends at the outer ${trimmed ? 'trimmed/stretched 24k' : 'plain'} clip extent`, async t => {
		const f = fixture(t, { trimmed });
		await f.bin.playPauseProjectBinClip('clip');
		assert.equal(f.engine.getState().playbackEndFrame, 48_000);
		const start = f.engine.getPlaybackAudibleStartTime();
		assert.ok(start !== null);
		f.context.currentTime = start + 1.01;
		await waitFor(() => f.preview()?.state === 'stopped', 'Bin terminal state');
		await f.bin.playPauseProjectBinClip('clip');
		assert.equal(f.engine.getPositionFrames(), 0);
	});
}

test('a canonical musical Bin clip uses its resolved duration', async t => {
	const f = fixture(t, { musical: true });
	await f.bin.playPauseProjectBinClip('clip');
	assert.equal(f.engine.getState().playbackEndFrame, 48_000);
});

test('Bin Pause/Resume restores its finite range and retains the current position', async t => {
	const f = fixture(t);
	await f.bin.playPauseProjectBinClip('clip');
	f.context.currentTime += .2;
	await f.bin.playPauseProjectBinClip('clip');
	const pausedPosition = f.engine.getPositionFrames();
	await f.bin.playPauseProjectBinClip('clip');
	assert.equal(f.engine.getState().playbackEndFrame, 48_000);
	assert.equal(f.engine.getPositionFrames(), pausedPosition);
});

for (const completed of [false, true]) {
	test(`a different Bin item starts at zero after ${completed ? 'natural end' : 'explicit Pause'}`, async t => {
		const f = fixture(t, { secondItem: true });
		await f.bin.playPauseProjectBinClip('clip');
		if (completed) {
			const start = f.engine.getPlaybackAudibleStartTime();
			assert.ok(start !== null);
			f.context.currentTime = start + 1.01;
			await waitFor(() => f.preview()?.state === 'stopped', 'the first Bin item to finish');
		} else {
			f.context.currentTime += .2;
			await f.bin.playPauseProjectBinClip('clip');
		}
		await f.bin.playPauseProjectBinClip('second');
		assert.equal(f.engine.getState().playbackEndFrame, 14_400);
		assert.equal(f.engine.getPositionFrames(), 0);
	});
}
