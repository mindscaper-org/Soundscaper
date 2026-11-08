/* SPDX-License-Identifier: AGPL-3.0-only */
import { scheduleProjectClips, type ScheduleProjectClipsOptions } from './clip-scheduler.ts';
import type { EngineRenderTimelineRange } from './public-api.ts';

/** Share the graph and processor history across a cut, scheduling each original automation window at its joined clock. */
export async function scheduleRenderTimeline(options: ScheduleProjectClipsOptions, ranges: readonly EngineRenderTimelineRange[]) {
	if (ranges.length === 1) return scheduleProjectClips(options);
	const completions: Promise<void>[] = [];
	let origin = options.contextStartTime, elapsedFrames = 0, streamedClips = 0;
	for (const [index, range] of ranges.entries()) {
		const requested = origin + elapsedFrames / (options.sampleRate * (options.transportRate ?? 1));
		const scheduled = await scheduleProjectClips({ ...options, fromFrame: range.startFrame, toFrame: range.endFrame,
			contextStartTime: requested });
		if (!index) origin = scheduled.contextStartTime;
		else if (Math.abs(scheduled.contextStartTime - requested) > 1 / options.context.sampleRate) {
			throw new Error('The joined render lost its continuous audio clock.');
		}
		const completion = scheduled.waitForStreamedClips();
		void completion.catch(() => undefined);
		completions.push(completion); streamedClips += scheduled.streamedClips;
		elapsedFrames += range.endFrame - range.startFrame;
	}
	return { contextStartTime: origin, streamedClips,
		async waitForStreamedClips(): Promise<void> { await Promise.all(completions); } };
}
