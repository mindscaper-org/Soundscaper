/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { projectClipsToViewport } from '../src/common/editor/design-system-adapters/timeline.ts';
import { projectUnwarpedClipSourceRange } from '../src/common/editor/audio-clip-source-projection.ts';
import { selectedTrackSpectralPeaks, snapSpectralCenterToPeak } from '../src/common/editor/ui/timeline/spectral-center-gesture.ts';

for (const options of [
	{}, { reversed: true }, { offset: 1 }, { trimmed: true },
	{ projectRate: 48_000 }, { projectRate: 48_000, reversed: true, offset: 1, trimmed: true },
]) test(`a partial loop wrap excludes unselected source peaks ${JSON.stringify(options)}`, () => {
	const f = fixture(options);
	const wrap = f.periodSeconds - (options.offset ?? 0);
	const selection = { startFrame: Math.round(f.projectRate * (wrap - .4)), endFrame: Math.round(f.projectRate * (wrap + .4)) };
	const peaks = f.peaks(selection);
	assert.ok(Math.abs(snapSpectralCenterToPeak(550, peaks) - 800) < 1,
		'the selected tail and head contain 800 Hz; the 512 Hz middle is outside the selection');
	assert.equal(f.channelReads(), 1);
	assert.ok(f.windows.length <= 2, 'sampling is bounded independently of repeat count');
	assert.ok(f.windows.reduce((sum, [start, end]) => sum + end - start, 0) <= Math.ceil(.8 * f.sourceRate) + 2,
		'FFT inputs cannot include unselected frames between the two source spans');
	assert.deepEqual(projectUnwarpedClipSourceRange(f.clip, selection.startFrame, selection.endFrame), {
		startFrame: f.clip.sourceStartFrame, endFrame: f.clip.sourceStartFrame + f.clip.sourceDurationFrames,
	}, 'other consumers retain their existing bounding-range API');
});

test('an ordinary non-wrapping selection still excludes unselected source content', () => {
	const f = fixture();
	const peaks = f.peaks({ startFrame: Math.round(f.projectRate * .4), endFrame: Math.round(f.projectRate * .8) });
	assert.ok(Math.abs(snapSpectralCenterToPeak(550, peaks) - 800) < 1);
	assert.equal(f.windows.length, 1);
});

for (const repeats of [1, 128]) test(`${repeats} complete selected periods sample the entire source once`, () => {
	const f = fixture({ repeats: Math.max(2, repeats) });
	const peaks = f.peaks({ startFrame: 0, endFrame: Math.round(f.projectRate * f.periodSeconds * repeats) });
	assert.ok(Math.abs(snapSpectralCenterToPeak(550, peaks) - 512) < 1, 'the selected full period really contains 512 Hz');
	assert.equal(f.channelReads(), 1);
	assert.equal(f.windows.length, 1, 'repetition cannot multiply PCM reads or FFT work');
});

function fixture(options: { reversed?: boolean; offset?: number; trimmed?: boolean; projectRate?: number; repeats?: number } = {}) {
	const sourceRate = 8192, projectRate = options.projectRate ?? sourceRate;
	const samples = Float32Array.from({ length: sourceRate * 4 }, (_, frame) => .4 * Math.sin(2 * Math.PI *
		(frame < sourceRate || frame >= sourceRate * 3 ? 800 : 512) * frame / sourceRate));
	const windows: [number, number][] = [];
	const subarray = samples.subarray.bind(samples);
	Object.defineProperty(samples, 'subarray', { value: (start: number, end: number) => { windows.push([start, end]); return subarray(start, end); } });
	const source = createAudioSource({ id: 'source', sampleRate: sourceRate, frameCount: samples.length, channelCount: 1 });
	const periodSeconds = options.trimmed ? 3 : 4;
	const base = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: projectRate * periodSeconds,
		sourceStartFrame: options.trimmed ? sourceRate / 2 : 0, sourceDurationFrames: sourceRate * periodSeconds, reversed: options.reversed ?? false });
	const track = createAudioTrack({ id: 'track', clipIds: [base.id] }, projectRate);
	const admission = createSoundscaperProject({ sampleRate: projectRate, sources: [source], clips: [base], tracks: [track] });
	const runtimeBase = resolveRuntimeClipProjection(admission, base);
	const authoredClip = { ...base, ...clipLoopUpdateFields(runtimeBase, { periodFrames: runtimeBase.durationFrames,
		offsetFrames: (options.offset ?? 0) * projectRate, durationFrames: runtimeBase.durationFrames * (options.repeats ?? 2) }) };
	const project = createSoundscaperProject({ ...admission, clips: [authoredClip] });
	const runtimeClip = resolveRuntimeClipProjection(project, authoredClip);
	const clip = projectClipsToViewport([runtimeClip], { sampleRate: projectRate,
		viewportDurationFrames: runtimeClip.durationFrames }).clips[0];
	assert.ok(clip);
	let reads = 0;
	const controller = { project, getClipVisualData: () => ({ source, buffer: { numberOfChannels: 1,
		getChannelData: () => { reads++; return samples; } } }) };
	return { clip, projectRate, sourceRate, periodSeconds, windows, channelReads: () => reads,
		peaks: (selection: { startFrame: number; endFrame: number }) => selectedTrackSpectralPeaks(controller, [clip], selection, projectRate) };
}
