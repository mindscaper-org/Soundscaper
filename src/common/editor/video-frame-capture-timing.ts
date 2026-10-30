/* SPDX-License-Identifier: AGPL-3.0-only */

import { demuxVideoTiming } from './video-timing-demux.ts';
import type { VideoTimingProbeResult } from './video-timing-probe.ts';

type CaptureTiming = Pick<VideoTimingProbeResult, 'timescale' | 'presentationTicks' | 'finalFrameDurationTicks'>;
type FrameMatcher = (timestamp: number, mediaTime: number) => boolean;
interface CaptureTimingOptions {
	readonly signal?: AbortSignal;
	readonly readTiming?: (file: Blob, options: Readonly<{ signal?: AbortSignal }>) => Promise<CaptureTiming>;
}
const ROUNDING_SECONDS = 0.000001;

/** Match compositor PTS to the container frame owning an interior capture seek. */
export async function createVideoFrameCaptureTimingMatcher(
	file: Blob,
	options: CaptureTimingOptions = {},
): Promise<FrameMatcher> {
	options.signal?.throwIfAborted();
	let timing: CaptureTiming;
	try {
		timing = await (options.readTiming ?? demuxVideoTiming)(file,
			options.signal ? { signal: options.signal } : {});
	} catch {
		options.signal?.throwIfAborted();
		// A native decoder may support a container the timing reader does not.
		return exactTimestamp;
	}
	options.signal?.throwIfAborted();
	const starts = timing.presentationTicks.map(ticks => Number(ticks) / timing.timescale);
	const end = Number(timing.presentationTicks.at(-1)! + timing.finalFrameDurationTicks) / timing.timescale;
	return (timestamp, mediaTime) => {
		if (!Number.isFinite(timestamp) || !Number.isFinite(mediaTime)) return false;
		if (!starts.length || timestamp < starts[0]! || timestamp >= end) return exactTimestamp(timestamp, mediaTime);
		let low = 0, high = starts.length;
		while (low + 1 < high) {
			const middle = (low + high) >>> 1;
			if (starts[middle]! <= timestamp) low = middle; else high = middle;
		}
		// A preceding frame can still be queued when currentTime is assigned.
		// The following frame's PTS is excluded even while seeking is true.
		return mediaTime >= starts[low]! - ROUNDING_SECONDS
			&& mediaTime < (starts[low + 1] ?? end);
	};
}

function exactTimestamp(timestamp: number, mediaTime: number): boolean {
	return Number.isFinite(timestamp) && Number.isFinite(mediaTime)
		&& Math.abs(timestamp - mediaTime) <= ROUNDING_SECONDS;
}
