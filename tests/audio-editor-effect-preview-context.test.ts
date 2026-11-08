/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { previewRenderedClipStarts } from '../src/common/editor/controller/effects/internal/preview-rendered-clip-placement.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioClip, createAudioTrack, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS } from '../src/common/editor/effects.js';

interface RenderCall {
	readonly trackId: string;
	readonly start: number;
	readonly end: number;
	readonly channels: number;
	readonly clipIds: readonly string[];
}

interface WorkerInput {
	readonly channels: Float32Array[];
	readonly context: Readonly<{
		beforeChannels: Float32Array[];
		afterChannels: Float32Array[];
	}>;
}

interface PreviewFixtureTarget {
	readonly track: Readonly<{ id: string }>;
	readonly clipId: string;
	readonly clipIds: readonly string[];
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
	readonly channelCount: number;
}

function fixture(start: number, end: number, projectEnd: number, cancelOnRender = 0, exactRangePcm = false, outputRatio = 1,
	options: Readonly<{ targets?: readonly PreviewFixtureTarget[]; sampleRate?: number; params?: Readonly<Record<string, number>>; project?: ReturnType<typeof createAudioEditorProjectV17> }> = {}) {
	const renders: RenderCall[] = [];
	const jobs: WorkerInput[] = [];
	const played: Float32Array[][] = [];
	const state = {
		audacityEffectType: 'audacity-repair',
		audacityEffectProcessing: false,
		audacityPreviewGeneration: 0,
		audacityPreviewSource: null as unknown,
		audacityEffectTouchedParams: new Map<string, Set<string>>(),
	};
	let started = 0;
	let published = 0;
	let sourcePaused = false;
	const source = {
		buffer: null as unknown,
		onended: null as (() => void) | null,
		connect: () => undefined,
		start: () => { started += 1; },
	};
	const preview = createSelectionEffectPreviewService({
		canSliceDryPcm: () => exactRangePcm,
		pauseSourcePreview: () => { sourcePaused = true; },
		state,
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 1_000_000,
		AUDIO_SELECTION_EFFECT_DEFINITIONS,
		abortError: () => new DOMException('Preview was cancelled', 'AbortError'),
		assertAudacityEffectOutput: (channels: Float32Array[]) => assert.equal(channels.length, 1),
		audacityEffectMemoryError: () => new Error('Preview exceeds memory limit'),
		audacityEffectTargets: () => options.targets ?? [{ track: { id: 'selected-track' },
			startFrame: start, endFrame: end, durationFrames: end - start,
			channelCount: 1, clipIds: ['selected-clip'] }],
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (channels: Float32Array[]) => {
			played.push(channels);
			return { channels };
		},
		cancelAudacityEffectPreview: () => { state.audacityPreviewGeneration += 1; },
		copy: { audacityPreviewProcessing: 'Preparing preview', audacityPreviewPlaying: 'Playing' },
		currentAudacityEffectParams: () => options.params ?? {},
		engine: {
			pause: () => undefined,
			getPlaybackDestination: () => ({}),
			getAudioContext: async () => ({ createBufferSource: () => source, destination: {} }),
		},
		estimateAudioSelectionEffectPeakBytes: () => 0,
		effectPreviewProject: options.project ? () => ({ clips: options.project!.clips.map(clip => ({ ...clip,
			timelineStartFrame: Number(clip.timelineStartFrame), durationFrames: Number(clip.durationFrames) })), tracks: options.project!.tracks }) : undefined,
		getProject: () => ({ id: 'selected-project' }),
		mixNyquistPreviewChannels,
		normalizeAudioSelectionEffectParams: (_type: string, params: unknown) => params,
		projectDurationFrames: () => projectEnd,
		projectSampleRate: () => options.sampleRate ?? 100,
		publishDocumentSnapshot: () => { published += 1; },
		renderDryTrackRange: async (trackId: string, from: number, to: number,
			channels: number, clipIds: readonly string[]) => {
			assert.equal(sourcePaused, true, 'source playback stops before effect preparation');
			renders.push({ trackId, start: from, end: to, channels, clipIds });
			if (renders.length === cancelOnRender) state.audacityPreviewGeneration += 1;
			return [Float32Array.from({ length: to - from }, (_, index) => (from + index) / 1_000)];
		},
		resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		runSelectionEffectWorker: async (request: WorkerInput) => {
			jobs.push(request);
			return { channels: request.channels.map((channel) => Float32Array.from(
				{ length: Math.round(channel.length * outputRatio) },
				(_, index) => -channel[Math.floor(index / outputRatio)]!,
			)) };
		},
		setStatus: () => undefined,
	});
	return { preview, state, renders, jobs, played, started: () => started, published: () => published, sourcePaused: () => sourcePaused };
}

test('effect previews pause the clip source transport before auditioning their result', async () => {
	const value = fixture(20, 24, 50);
	await value.preview();
	assert.equal(value.sourcePaused(), true);
});

test('duration-changing previews use the rendered length within the six-second audition limit', async () => {
	for (const [inputFrames, ratio, outputFrames] of [[80, 2, 160], [80, 0.5, 40], [500, 2, 600]] as const) {
		const value = fixture(0, inputFrames, inputFrames, 0, false, ratio);
		value.state.audacityEffectType = 'audacity-change-tempo';
		await value.preview();
		assert.equal(value.played[0]![0]!.length, outputFrames);
		assert.notEqual(value.played[0]![0]!.at(-1), 0, 'the preview neither drops the tail nor appends silence');
	}
});

test('duration-changing multi-clip preview preserves the same ripple timing as Apply', async () => {
	const rate = 8000;
	const project = createAudioEditorProjectV17({ sampleRate: rate,
		sources: [createAudioSource({ id: 'source', sampleRate: rate, frameCount: rate, channelCount: 1 })],
		clips: [0, 3 * rate].map((start, index) => ({ ...createAudioClip({ id: `clip-${index}`, sourceId: 'source',
			timelineStartFrame: start, durationFrames: rate, sourceDurationFrames: rate }) })),
		tracks: [{ ...createAudioTrack({ id: 'selected-track', clipIds: ['clip-0', 'clip-1'] }, rate) }],
	});
	const applied = applyEditorCommand(project, { type: 'clip/render-replace-many', entries: project.clips.map((clip, index) => ({
		clipId: clip.id, source: { ...createAudioSource({ id: `processed-${index}`, sampleRate: rate, frameCount: 2 * rate, channelCount: 1 }) },
	})) });
	const expectedEnd = Math.max(...applied.clips.map(clip => Number(clip.timelineStartFrame) + Number(clip.durationFrames)));
	assert.equal(expectedEnd, 6 * rate);
	const value = fixture(0, 4 * rate, 4 * rate, 0, false, 2, { sampleRate: rate, project, params: { tempoPercent: -50 },
		targets: [0, 3 * rate].map((start, index) => ({ track: { id: 'selected-track' }, clipId: `clip-${index}`,
			clipIds: [`clip-${index}`], startFrame: start, endFrame: start + rate, durationFrames: rate, channelCount: 1 })),
	});
	value.state.audacityEffectType = 'audacity-change-tempo';
	await value.preview();
	assert.equal(value.played[0]![0]!.length, expectedEnd, 'Preview must retain the same later-clip gap and end as Apply');
	assert.equal(value.played[0]![0]![3 * rate], 0, 'the second clip starts at its rippled position, not the old timeline offset');
	assert.notEqual(value.played[0]![0]![4 * rate], 0);
});

test('shortening an earlier selected clip brings later selected audio into the audition', async () => {
	const rate = 8000;
	const value = fixture(0, 60000, 60000, 0, false, 0.5, { sampleRate: rate, params: { tempoPercent: 100 },
		targets: [{ track: { id: 'track' }, clipId: 'first', clipIds: ['first'], startFrame: 0, endFrame: 16000, durationFrames: 16000, channelCount: 1 },
			{ track: { id: 'track' }, clipId: 'last', clipIds: ['last'], startFrame: 52000, endFrame: 60000, durationFrames: 8000, channelCount: 1 }],
	});
	value.state.audacityEffectType = 'audacity-change-tempo';
	await value.preview();
	assert.equal(value.jobs.length, 2);
	assert.equal(value.played[0]![0]!.length, 48000);
	assert.notEqual(value.played[0]![0]![44000], 0, 'later audio enters the six-second audition after the earlier contraction');
});

test('preview placement keeps independent lanes and grouped component timing equal to publication', () => {
	const rate = 8000;
	for (const grouped of [false, true]) {
		const project = createAudioEditorProjectV17({ sampleRate: rate,
			sources: [createAudioSource({ id: 'source', sampleRate: rate, frameCount: rate, channelCount: 1 })],
			clips: [0, 3 * rate].map((start, index) => ({ ...createAudioClip({ id: `clip-${index}`, sourceId: 'source',
				timelineStartFrame: start, durationFrames: rate, sourceDurationFrames: rate, ...(grouped ? { groupId: 'group' } : {}) }) })),
			tracks: [0, 1].map(index => ({ ...createAudioTrack({ id: `track-${index}`, clipIds: [`clip-${index}`] }, rate) })),
		});
		const entries = project.clips.map((clip, index) => ({ clipId: clip.id, source: {
			...createAudioSource({ id: `processed-${index}`, sampleRate: rate, frameCount: 2 * rate, channelCount: 1 }),
		} }));
		const applied = applyEditorCommand(project, { type: 'clip/render-replace-many', entries });
		const before = structuredClone(project);
		const actual = previewRenderedClipStarts({ ...project, clips: project.clips.map(clip => ({ ...clip,
			timelineStartFrame: Number(clip.timelineStartFrame), durationFrames: Number(clip.durationFrames) })) },
			entries.map(entry => ({ clipId: entry.clipId, frameCount: entry.source.frameCount })));
		assert.deepEqual(actual, applied.clips.map(clip => clip.timelineStartFrame));
		assert.deepEqual(actual, [0, grouped ? 6 * rate : 3 * rate]);
		assert.deepEqual(project, before, 'preview geometry cannot mutate the document');
	}
});

test('preview placement retains empty-clip deletion ripple and mixed-group refusal', () => {
	const clips = [0, 24000].map((timelineStartFrame, index) => ({ id: `clip-${index}`, timelineStartFrame, durationFrames: 8000 }));
	const project = { clips, tracks: [{ id: 'track', clipIds: clips.map(clip => clip.id) }] };
	const results = [{ clipId: 'clip-0', frameCount: 0 }, { clipId: 'clip-1', frameCount: 4000 }];
	assert.deepEqual(previewRenderedClipStarts(project, results), [0, 16000]);
	assert.throws(() => previewRenderedClipStarts({ ...project, clips: clips.map(clip => ({ ...clip, groupId: 'same' })) }, results),
		/inconsistent effect duration ratios/u);
});

test('Amplify previews reuse an admitted full-selection render and preserve its frame offset', async () => {
	for (const admitted of [false, true]) {
		const value = fixture(20, 724, 1_000, 0, admitted);
		value.state.audacityEffectType = 'audacity-amplify';
		assert.equal(await value.preview(), true);
		assert.equal(value.renders.length, admitted ? 1 : 2);
		assert.deepEqual(value.renders[0], { trackId: 'selected-track', start: 20, end: 724,
			channels: 1, clipIds: ['selected-clip'] });
		assert.equal(value.jobs[0]!.channels[0]!.length, 600);
		assert.deepEqual(value.jobs[0]!.channels[0], Float32Array.from({ length: 600 }, (_, index) => (20 + index) / 1_000));
	}
});

test('Repair previews supply clip-scoped context clipped to the project and play only the selection', async () => {
	for (const [start, end, projectEnd] of [[20, 24, 50], [0, 4, 50], [46, 50, 50], [220, 224, 500]] as const) {
		const value = fixture(start, end, projectEnd);
		assert.equal(await value.preview(), true);
		const beforeStart = Math.max(0, start - 128);
		const afterEnd = Math.min(projectEnd, end + 128);
		assert.deepEqual(value.renders, [
			[start, end], ...(beforeStart < start ? [[beforeStart, start]] : []),
			...(end < afterEnd ? [[end, afterEnd]] : []),
		].map(([from, to]) => ({ trackId: 'selected-track', start: from, end: to,
			channels: 1, clipIds: ['selected-clip'] })));
		assert.equal(value.jobs.length, 1);
		const { channels, context } = value.jobs[0]!;
		assert.equal(context.beforeChannels[0]!.length, start - beforeStart);
		assert.equal(context.afterChannels[0]!.length, afterEnd - end);
		assert.equal(channels[0]!.length, end - start);
		assert.deepEqual(Array.from(value.played[0]![0]!), Array.from(channels[0]!, (sample) => sample === 0 ? 0 : -sample));
		assert.equal(value.started(), 1);
		assert.equal(value.state.audacityEffectProcessing, false);
	}
});

test('cancelling a Repair preview during context reads never launches the worker or playback', async () => {
	for (const cancelOnRender of [2, 3]) {
		const value = fixture(20, 24, 50, cancelOnRender);
		assert.equal(await value.preview(), false);
		assert.equal(value.renders.length, cancelOnRender);
		assert.deepEqual(value.jobs, []);
		assert.deepEqual(value.played, []);
		assert.equal(value.started(), 0);
		assert.equal(value.state.audacityPreviewSource, null);
		assert.equal(value.state.audacityEffectProcessing, false);
		assert.equal(value.published(), 2, 'cancelled processing clears its published busy state');
	}
});
