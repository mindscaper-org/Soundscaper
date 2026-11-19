/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	SummaryWaveformChannel,
	WaveformRendering,
} from '../../design-system-adapters/types.ts';

interface RetainedWaveform extends WaveformRendering {
	readonly sourceId?: string;
	readonly waveformIdentity?: string;
}

interface PendingClip {
	readonly sourceId?: string;
	readonly waveformIdentity?: string;
	readonly waveformStartFrame?: number;
	readonly waveformEndFrame?: number;
	readonly trimStart: number;
	readonly duration: number;
}

/** Keep existing audio aligned during a viewport change while a finer read completes. */
export function reprojectPendingWaveform(
	plan: RetainedWaveform,
	clip: PendingClip,
	sampleRate: number,
	pixelWidth: number,
): RetainedWaveform | null {
	if (plan.sourceId !== clip.sourceId || plan.waveformIdentity !== clip.waveformIdentity) return null;
	if (!(sampleRate > 0) || !(pixelWidth > 0) || !(plan.frameCount > 0)) return null;
	const startFrame = clip.waveformStartFrame ?? Math.round(clip.trimStart * sampleRate);
	const endFrame = clip.waveformEndFrame ?? Math.round((clip.trimStart + clip.duration) * sampleRate);
	if (!(endFrame > startFrame) || endFrame <= plan.startFrame || startFrame >= plan.endFrame) return null;
	return reprojectWaveformRange(plan, startFrame, endFrame, pixelWidth);
}

export function reprojectWaveformRange<T extends WaveformRendering>(
	plan: T,
	startFrame: number,
	endFrame: number,
	pixelWidth: number,
): T {
	if (plan.startFrame === startFrame && plan.endFrame === endFrame && plan.pixelWidth === pixelWidth) return plan;
	const frameCount = endFrame - startFrame;
	const scale = plan.frameCount / frameCount * pixelWidth / plan.pixelWidth;
	const offset = (plan.startFrame - startFrame) / frameCount * pixelWidth;
	const columns = Math.max(1, Math.ceil(pixelWidth));
	// Wider layouts can amortize one bin projection across equal-width channels.
	const sharedBins = plan.channels.length >= 4 ? new Map<number, Float64Array>() : undefined;
	return {
		...plan,
		startFrame,
		endFrame,
		frameCount,
		pixelWidth,
		pixelsPerSample: plan.pixelsPerSample * scale,
		channels: plan.channels.map((channel) => 'samples' in channel
			? { ...channel, firstSampleX: offset + channel.firstSampleX * scale }
			: projectSummary(channel, plan, startFrame, frameCount, columns, sharedBins)),
	};
}

function projectSummary(
	channel: SummaryWaveformChannel,
	plan: WaveformRendering,
	startFrame: number,
	frameCount: number,
	columns: number,
	sharedBins: Map<number, Float64Array> | undefined,
): SummaryWaveformChannel {
	const sourceColumns = Math.min(channel.minimum.length, channel.maximum.length);
	const minimum = new Float32Array(columns);
	const maximum = new Float32Array(columns);
	const rms = channel.rms ? new Float32Array(columns) : null;
	let bins = sharedBins?.get(sourceColumns);
	const buildBins = sharedBins && !bins;
	if (buildBins) bins = new Float64Array(columns * 2);
	for (let column = 0; column < columns; column += 1) {
		let first: number, last: number;
		if (bins && !buildBins) {
			first = bins[column * 2]!;
			last = bins[column * 2 + 1]!;
		} else {
			const from = (startFrame + column / columns * frameCount - plan.startFrame) / plan.frameCount * sourceColumns;
			const to = (startFrame + (column + 1) / columns * frameCount - plan.startFrame) / plan.frameCount * sourceColumns;
			first = Math.max(0, Math.floor(from));
			last = Math.min(sourceColumns, Math.ceil(to));
			if (bins) { bins[column * 2] = first; bins[column * 2 + 1] = last; }
		}
		if (first >= last) continue;
		let lower = Infinity;
		let upper = -Infinity;
		let sum = 0;
		for (let index = first; index < last; index += 1) {
			lower = Math.min(lower, channel.minimum[index] ?? 0);
			upper = Math.max(upper, channel.maximum[index] ?? 0);
			if (rms) sum += (channel.rms?.[index] ?? 0) ** 2;
		}
		minimum[column] = lower;
		maximum[column] = upper;
		if (rms) rms[column] = Math.sqrt(sum / (last - first));
	}
	if (buildBins) sharedBins.set(sourceColumns, bins!);
	return { minimum, maximum, rms };
}
