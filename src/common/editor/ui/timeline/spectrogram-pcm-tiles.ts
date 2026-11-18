/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	audioWarpSourceRange,
	type AudioWarpRuntimeClip,
	type AudioWarpRuntimeProject,
} from '../../audio-warp-runtime.ts';
import { projectUnwarpedClipSourceRange } from '../../audio-clip-source-projection.ts';
import { readClipLoop } from '../../audio-clip-loop.ts';
import {
	pffftSpectrogramBandEnergies,
	preparePffftSpectrogram,
} from '../../pffft-spectrogram.js';
import { analyzeTimelineSpectrogramTileInWorker } from '../../timeline-spectrogram-worker-client.ts';
import type { SpectrogramColumnCacheView } from '../../controller/source/timeline-spectrogram-cache.ts';
import { pcmWindowCoversProjectedClip } from './preview.ts';
import { alignedSpectrogramFramesPerPixel } from './spectrogram-column-reuse.ts';
import { readLoopSpectrogramPcmWindow } from './spectrogram-loop-pcm-window.ts';
import {
	createSpectrogramSampleViews,
	type SpectrogramSampleView,
} from './spectrogram-sample-view.ts';
import type { TimelinePcmWindow, TimelineWaveformClip } from './waveform-view-model.ts';

const DEFAULT_MAXIMUM_SOURCE_FRAMES = 262_144;
// The waveform PCM requester adds two source frames at either end of a range.
const SOURCE_REQUEST_PADDING_FRAMES = 4;

export interface SpectrogramPcmTileAnalysisOptions {
	readonly fftWindowSize: number;
	readonly frequencyBands?: number;
	readonly windowType?: string;
	readonly pixelSkip: number;
	/** Start and end in the full canvas's pixel coordinate system. */
	readonly pixelStart: number;
	readonly pixelEnd: number;
}

export type SpectrogramPcmTileAnalyzer = (
	view: SpectrogramSampleView,
	width: number,
	options: SpectrogramPcmTileAnalysisOptions,
) => readonly (readonly number[])[] | null;

export interface SpectrogramPcmTileOptions {
	readonly clip: TimelineWaveformClip;
	readonly project?: AudioWarpRuntimeProject | null;
	readonly width: number;
	readonly fftWindowSize: number;
	readonly frequencyBands?: number;
	readonly windowType?: string;
	readonly pixelSkip?: number;
	readonly maximumSourceFrames?: number;
	readonly requestPcmWindow: (
		startFrame: number,
		endFrame: number,
	) => Promise<TimelinePcmWindow | null>;
	readonly analyze?: SpectrogramPcmTileAnalyzer;
	readonly signal?: AbortSignal;
	readonly columnCache?: SpectrogramColumnCacheView;
}

export interface SpectrogramPcmColumns {
	readonly width: number;
	readonly pixelSkip: number;
	/** Full-width frequency columns for each channel, ready for paintSpectrogram. */
	readonly channels: readonly (readonly (readonly number[])[])[];
}

/** Analyze streamed PCM a bounded tile at a time, retaining only spectral columns. */
export async function generateSpectrogramPcmTiles(
	options: SpectrogramPcmTileOptions,
): Promise<SpectrogramPcmColumns | null> {
	const { clip, project = null, signal } = options;
	const { width } = options;
	// PFFFT clamps its FFT input at 8,192 samples; tile reads need the same span.
	const fftWindowSize = Math.min(8_192, options.fftWindowSize);
	const pixelSkip = options.pixelSkip ?? 1;
	const maximumSourceFrames = options.maximumSourceFrames ?? DEFAULT_MAXIMUM_SOURCE_FRAMES;
	if (!Number.isFinite(width) || width <= 0 || !Number.isSafeInteger(fftWindowSize)
		|| fftWindowSize < 32 || fftWindowSize > 8_192
		|| (fftWindowSize & (fftWindowSize - 1)) !== 0
		|| !Number.isSafeInteger(pixelSkip) || pixelSkip < 1
		|| !Number.isSafeInteger(maximumSourceFrames)
		|| maximumSourceFrames <= SOURCE_REQUEST_PADDING_FRAMES) {
		throw new RangeError('Invalid spectrogram PCM tile geometry.');
	}
	const frameCount = clip.waveformEndFrame - clip.waveformStartFrame;
	if (!Number.isSafeInteger(frameCount) || frameCount < 0) {
		throw new RangeError('Invalid projected spectrogram clip range.');
	}
	if (frameCount === 0) return { width, pixelSkip, channels: [] };
	const columnCache = alignedSpectrogramFramesPerPixel(clip, width, pixelSkip) === null ? null : options.columnCache;
	const analyze = options.analyze ?? analyzePffft;
	const useWorker = !options.analyze && typeof Worker === 'function';
	let mainPrepared = Boolean(options.analyze);
	const pixelCount = Math.ceil(width / pixelSkip);
	const pixelAt = (index: number): number => index * pixelSkip;
	const localStartAt = (pixel: number): number => clip.waveformStartFrame
		+ Math.floor(pixel * frameCount / width);
	const leftContext = Math.floor(fftWindowSize / 2);
	const rightContext = fftWindowSize - leftContext;
	const sourceLimit = maximumSourceFrames - SOURCE_REQUEST_PADDING_FRAMES;
	const loop = readClipLoop(clip);
	const fragmentedLoop = loop && (clip.sourceDurationFrames ?? clip.durationFrames) > sourceLimit;
	let unwarpedGeometry: Parameters<typeof projectUnwarpedClipSourceRange>[0] | null = null;
	let warpedGeometry: AudioWarpRuntimeClip | null = null;
	const sourceSpan = (startFrame: number, endFrame: number): number => {
		if (fragmentedLoop && loop) return Math.max(endFrame - startFrame,
			Math.ceil((endFrame - startFrame) * (clip.sourceDurationFrames ?? clip.durationFrames) / loop.periodFrames) + 2);
		const range = clip.warpMap == null
			? projectUnwarpedClipSourceRange(unwarpedGeometry ??= {
				opaqueExtensions: clip.opaqueExtensions,
				durationFrames: clip.durationFrames,
				sourceStartFrame: clip.sourceStartFrame,
				sourceDurationFrames: clip.sourceDurationFrames ?? clip.durationFrames,
				reversed: Boolean(clip.reversed),
			}, startFrame, endFrame)
			: project
				? audioWarpSourceRange(project, warpedGeometry ??= {
					...clip,
					sourceDurationFrames: clip.sourceDurationFrames ?? clip.durationFrames,
				} as AudioWarpRuntimeClip, { startFrame, endFrame })
				: null;
		if (!range) throw new TypeError('A warped spectrogram tile requires a project.');
		return Math.ceil(range.endFrame) - Math.floor(range.startFrame);
	};
	let columnsByChannel: Array<Array<readonly number[]>> | null = null;
	const appendColumn = (column: readonly (readonly number[])[]): void => {
		if (columnsByChannel === null) columnsByChannel = column.map(() => []);
		if (columnsByChannel.length !== column.length) throw new Error('Spectrogram PCM channel count changed between tiles.');
		for (let channel = 0; channel < column.length; channel += 1) columnsByChannel[channel]!.push(column[channel]!);
	};
	for (let first = 0; first < pixelCount;) {
		signal?.throwIfAborted();
		const firstCenter = localStartAt(pixelAt(first));
		const cached = columnCache?.read(firstCenter);
		if (cached) { appendColumn(cached); first += 1; continue; }
		if (!useWorker && !mainPrepared) {
			await preparePffftSpectrogram(fftWindowSize);
			signal?.throwIfAborted();
			mainPrepared = true;
		}
		unwarpedGeometry = null;
		warpedGeometry = null;
		const startFrame = Math.max(0, firstCenter - leftContext);
		let last = first;
		let endFrame = Math.min(clip.durationFrames, firstCenter + rightContext);
		if (sourceSpan(startFrame, endFrame) > sourceLimit) {
			throw new RangeError('One spectrogram FFT window exceeds the bounded PCM request limit.');
		}
		while (last + 1 < pixelCount) {
			const center = localStartAt(pixelAt(last + 1));
			if (columnCache?.read(center)) break;
			const candidateEnd = Math.min(clip.durationFrames, center + rightContext);
			if (sourceSpan(startFrame, candidateEnd) > sourceLimit) break;
			last += 1;
			endFrame = candidateEnd;
		}
		const fragment = fragmentedLoop ? await readLoopSpectrogramPcmWindow(
			clip, startFrame, endFrame, options.requestPcmWindow, signal,
		) : null;
		const pcm = fragmentedLoop ? fragment?.pcm : await options.requestPcmWindow(startFrame, endFrame);
		signal?.throwIfAborted();
		const tileClip = fragment?.clip ?? { ...clip, waveformStartFrame: startFrame, waveformEndFrame: endFrame };
		if (!pcm || !pcmWindowCoversProjectedClip(pcm, tileClip, project)) return null;

		const pixelStart = pixelAt(first);
		const pixelEnd = Math.min(width, pixelAt(last) + pixelSkip);
		const frameOffset = startFrame - clip.waveformStartFrame;
		const analysisOptions = { fftWindowSize, frequencyBands: options.frequencyBands, windowType: options.windowType, pixelSkip, pixelStart, pixelEnd };
		let tileChannels: readonly (readonly (readonly number[])[])[];
		if (useWorker && pcm.channels.length <= 8) {
			tileChannels = await analyzeTimelineSpectrogramTileInWorker({
				channels: pcm.channels, clip: tileClip, project: project ? { sampleRate: project.sampleRate, tempoMap: project.tempoMap } : null,
				sourceFrameOffset: pcm.startFrame, frameCount, offset: frameOffset, width, options: analysisOptions,
			}, { signal });
			signal?.throwIfAborted();
		} else {
			if (!mainPrepared) {
				await preparePffftSpectrogram(fftWindowSize);
				signal?.throwIfAborted();
				mainPrepared = true;
			}
			const views = createSpectrogramSampleViews(pcm.channels, tileClip, { project, sourceFrameOffset: pcm.startFrame });
			const analyzed: Array<readonly (readonly number[])[]> = [];
			for (const view of views) {
				const globalView: SpectrogramSampleView = {
					length: frameCount,
					sampleAt: (index) => view.sampleAt(index - frameOffset),
				};
				const columns = analyze(globalView, width, options.analyze ? { ...analysisOptions } : analysisOptions);
				if (columns === null) return null;
				analyzed.push(columns);
			}
			tileChannels = analyzed;
		}
		const expectedColumns = last - first + 1;
		if (tileChannels.some((columns) => columns.length !== expectedColumns)) {
			throw new Error('Spectrogram PCM tile analysis returned incomplete columns.');
		}
		signal?.throwIfAborted();
		if (columnCache) {
			for (let offset = 0; offset < expectedColumns; offset += 1) {
				const column = tileChannels.map((channel) => channel[offset]!);
				appendColumn(column);
				columnCache.write(localStartAt(pixelAt(first + offset)), column);
			}
		} else {
			const output = columnsByChannel ??= tileChannels.map(() => []);
			if (output.length !== tileChannels.length) throw new Error('Spectrogram PCM channel count changed between tiles.');
			for (const [channel, columns] of tileChannels.entries()) {
				const destination = output[channel]!;
				for (const column of columns) destination.push(column);
			}
		}
		first = last + 1;
	}
	return { width, pixelSkip, channels: columnsByChannel ?? [] };
}

function analyzePffft(
	view: SpectrogramSampleView,
	width: number,
	options: SpectrogramPcmTileAnalysisOptions,
): readonly (readonly number[])[] | null {
	const result: unknown = pffftSpectrogramBandEnergies(view, width, options);
	return result === null ? null : result as readonly (readonly number[])[];
}
