/* SPDX-License-Identifier: AGPL-3.0-only */

import { recordingLeadInFrames } from '../recording-model.ts';
import { secondsToSampleFrame } from '../../../timeline-time.ts';
import { CLOCKED_RECORDING_START_LEAD_SECONDS } from '../../../recording-start-lead.ts';
import type { RecordingProject } from '../recording-transaction-types.ts';

export interface RecordingStartTimingRequest {
	readonly project: RecordingProject;
	readonly timedStartTimeMs: number | null;
	readonly currentTimeMs: number;
	readonly contextCurrentTime: number;
	readonly projectSampleRate: number;
	readonly contextSampleRate: number;
	readonly requestedStartFrame: number;
	readonly leadInEnabled: boolean;
	readonly leadInDurationSeconds?: number | null;
	readonly createTimedRecordingPastError: () => Error;
}

export interface RecordingStartTimingPlan {
	readonly scheduledTime: number;
	readonly availableLeadInFrames: number;
	readonly seekFrame: number;
	readonly captureStartFrame: (contextStartTime: number) => number;
}

/** The recorder starts when project audio reaches the output clock. */
export function audibleRecordingStartTime(
	playbackStartTime: unknown,
	requestedStartTime: number,
	graphLatencyFrames: number,
	contextSampleRate: number,
): number {
	if (!Number.isSafeInteger(graphLatencyFrames) || graphLatencyFrames < 0
		|| !Number.isFinite(contextSampleRate) || contextSampleRate <= 0) {
		throw new RangeError('Invalid playback graph latency for recording.');
	}
	const sourceStartTime = typeof playbackStartTime === 'number' && Number.isFinite(playbackStartTime)
		? playbackStartTime : requestedStartTime;
	return sourceStartTime + graphLatencyFrames / contextSampleRate;
}

/** Resume uses the same audible graph boundary as initial recording, on the input clock. */
export function recordingResumeTiming(
	context: Readonly<{ currentTime: number; sampleRate: number }>, candidate: number, latencyFrames: number,
) {
	if (!Number.isSafeInteger(latencyFrames) || latencyFrames < 0) {
		throw new RangeError('Invalid playback graph latency for recording.');
	}
	const frameAt = (sourceTime: number) => {
		// Round the source clock before adding integer PDC, so converting the
		// confirmed capture frame back cannot precede the source candidate.
		const frame = secondsToSampleFrame(sourceTime, context.sampleRate, 'enclosingEnd') + latencyFrames;
		if (!Number.isSafeInteger(frame)) throw new RangeError('The recording start is outside the safe integer range.');
		return frame;
	};
	const requestedFrame = frameAt(candidate);
	const sourceTime = (confirmedFrame: number) => (confirmedFrame - latencyFrames) / context.sampleRate;
	return {
		requestedFrame,
		minimumFutureFrame: (attempt: number) => frameAt(context.currentTime + CLOCKED_RECORDING_START_LEAD_SECONDS * 2 ** attempt),
		sourceTime,
		isFuture: (confirmedFrame: number) => sourceTime(confirmedFrame) > context.currentTime + 128 / context.sampleRate,
	};
}

/** Resolve the timing shared by legacy and routed recording starts. */
export function planRecordingStartTiming({
	project,
	timedStartTimeMs,
	currentTimeMs,
	contextCurrentTime,
	projectSampleRate,
	contextSampleRate,
	requestedStartFrame,
	leadInEnabled,
	leadInDurationSeconds = null,
	createTimedRecordingPastError,
}: RecordingStartTimingRequest): RecordingStartTimingPlan {
	const remainingSeconds = timedStartTimeMs === null
		? null
		: (timedStartTimeMs - currentTimeMs) / 1_000;
	if (remainingSeconds !== null && remainingSeconds <= 0) {
		throw createTimedRecordingPastError();
	}
	const scheduledTime = remainingSeconds === null
		? contextCurrentTime + CLOCKED_RECORDING_START_LEAD_SECONDS
		: contextCurrentTime + remainingSeconds;
	const leadInFrames = remainingSeconds === null && leadInEnabled
		? recordingLeadInFrames(project, projectSampleRate, requestedStartFrame, leadInDurationSeconds)
		: 0;
	const availableLeadInFrames = Math.min(leadInFrames, requestedStartFrame);
	return Object.freeze({
		scheduledTime,
		availableLeadInFrames,
		seekFrame: requestedStartFrame - availableLeadInFrames,
		captureStartFrame: (contextStartTime: number) => secondsToSampleFrame(
			contextStartTime + availableLeadInFrames / projectSampleRate,
			contextSampleRate,
			'enclosingEnd',
		),
	});
}
