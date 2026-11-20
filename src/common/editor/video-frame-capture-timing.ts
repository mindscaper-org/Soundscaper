/* SPDX-License-Identifier: AGPL-3.0-only */

import { demuxVideoTiming } from './video-timing-demux.ts';
import { browserVideoFrameSeekSeconds } from './video-drawable-interval.ts';
import type { VideoTimingProbeResult } from './video-timing-probe.ts';

type CaptureTiming = Pick<VideoTimingProbeResult, 'timescale' | 'presentationTicks' | 'finalFrameDurationTicks'>;
type FrameMatcher = (timestamp: number, mediaTime: number) => boolean;
interface VideoFrameCaptureTiming {
	readonly matches: FrameMatcher;
	readonly matchesPresentation: FrameMatcher;
	readonly seekTime: (timestamp: number, phase?: 'retry') => number | null;
	readonly clampTime: (timestamp: number, duration: number) => number;
}
interface CaptureTimingOptions {
	readonly signal?: AbortSignal;
	readonly timing?: CaptureTiming;
	readonly compositorTimeOffset?: number;
	readonly readTiming?: (file: Blob, options: Readonly<{ signal?: AbortSignal }>) => Promise<CaptureTiming>;
}
const ROUNDING_SECONDS = 0.000001;

/** Match compositor PTS to the container frame owning an interior capture seek. */
export async function createVideoFrameCaptureTiming(
	file: Blob,
	options: CaptureTimingOptions = {},
): Promise<Readonly<VideoFrameCaptureTiming>> {
	options.signal?.throwIfAborted();
	let timing: CaptureTiming;
	try {
		timing = options.timing ?? await (options.readTiming ?? demuxVideoTiming)(file,
			options.signal ? { signal: options.signal } : {});
	} catch {
		options.signal?.throwIfAborted();
		// A native decoder may support a container the timing reader does not.
		return Object.freeze({ matches: exactTimestamp, matchesPresentation: exactTimestamp,
			seekTime: () => null, clampTime: clampUnindexedTime });
	}
	options.signal?.throwIfAborted();
	const starts = timing.presentationTicks.map(ticks => Number(ticks) / timing.timescale);
	const end = Number(timing.presentationTicks.at(-1)! + timing.finalFrameDurationTicks) / timing.timescale;
	const frameAt = (timestamp: number): number | null => {
		if (!Number.isFinite(timestamp) || !starts.length || timestamp < starts[0]! || timestamp >= end) return null;
		let low = 0, high = starts.length;
		while (low + 1 < high) {
			const middle = (low + high) >>> 1;
			if (starts[middle]! <= timestamp) low = middle; else high = middle;
		}
		return low;
	};
	const matches: FrameMatcher = (timestamp, mediaTime) => {
		const frame = frameAt(timestamp);
		if (frame === null) return exactTimestamp(timestamp, mediaTime);
		// A preceding frame can still be queued when currentTime is assigned.
		// The following frame's PTS is excluded even while seeking is true.
		return mediaTime >= starts[frame]! - ROUNDING_SECONDS
			&& mediaTime < (starts[frame + 1] ?? end);
	};
	const seekTime: VideoFrameCaptureTiming['seekTime'] = (timestamp, phase) => {
		const frame = frameAt(timestamp);
		if (frame === null) return null;
		const start = starts[frame]!;
		const target = browserVideoFrameSeekSeconds(start, starts[frame + 1] ?? end);
		if (phase !== 'retry') return target;
		const retry = target - Math.min(0.001, (target - start) / 2);
		return retry < target ? retry : null;
	};
	const clampTime = (timestamp: number, duration: number): number => {
		const last = starts.at(-1);
		if (last === undefined) return clampUnindexedTime(timestamp, duration);
		// Native duration can round to the last picture's start. Preserve the indexed interval.
		return timestamp < end ? timestamp : last;
	};
	return Object.freeze({ matches, seekTime, clampTime,
		matchesPresentation: (timestamp: number, mediaTime: number) => matches(timestamp, mediaTime - (options.compositorTimeOffset ?? 0)),
	});
}

/** Linux WebKit's GStreamer callback clock includes the signed MP4 composition shift. */
export function linuxWebKitCompositorOffset(compositionShiftSeconds: number): number {
	const navigator = globalThis.navigator;
	return navigator?.platform.startsWith('Linux') && navigator.vendor === 'Apple Computer, Inc.'
		? compositionShiftSeconds : 0;
}

function clampUnindexedTime(timestamp: number, duration: number): number {
	return Math.min(timestamp, Math.max(0, duration - 0.001));
}

function exactTimestamp(timestamp: number, mediaTime: number): boolean {
	return Number.isFinite(timestamp) && Number.isFinite(mediaTime)
		&& Math.abs(timestamp - mediaTime) <= ROUNDING_SECONDS;
}
