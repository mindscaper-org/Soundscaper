/* SPDX-License-Identifier: AGPL-3.0-only */

interface PunchTransitionClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

interface PunchTransitionRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

interface PunchTransitionRequest {
	readonly transitionInFrames?: number;
	readonly transitionOutFrames?: number;
}

function boundedFrames(value: unknown, durationFrames: number): number {
	if (value === undefined) return 0;
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError('Punch transition frames must be a nonnegative safe integer.');
	}
	return Math.min(value as number, Math.floor((durationFrames - 1) / 2));
}

function uniqueBoundaryClip(clips: readonly PunchTransitionClip[], frame: number): PunchTransitionClip | null {
	let candidate: PunchTransitionClip | null = null;
	for (const clip of clips) {
		if (clip.timelineStartFrame >= frame || clip.timelineStartFrame + clip.durationFrames <= frame) continue;
		if (candidate) return null;
		candidate = clip;
	}
	return candidate;
}

/** Keep only unambiguous old material under each edge of a recorded punch. */
export function punchTransitionCutRange(
	range: PunchTransitionRange,
	clips: readonly PunchTransitionClip[],
	request: PunchTransitionRequest = {},
): PunchTransitionRange & { readonly durationFrames: number } {
	const durationFrames = range.endFrame - range.startFrame;
	const requestedIn = boundedFrames(request.transitionInFrames, durationFrames);
	const requestedOut = boundedFrames(request.transitionOutFrames, durationFrames);
	let startFrame = range.startFrame;
	let endFrame = range.endFrame;
	if (requestedIn > 0) {
		const outgoing = uniqueBoundaryClip(clips, range.startFrame);
		if (outgoing && clips.every((clip) => clip === outgoing
			|| clip.timelineStartFrame + clip.durationFrames <= range.startFrame
			|| clip.timelineStartFrame >= range.startFrame + requestedIn)) {
			startFrame += requestedIn;
		}
	}
	if (requestedOut > 0) {
		const candidate = uniqueBoundaryClip(clips, range.endFrame);
		if (candidate) {
			const available = Math.min(requestedOut, range.endFrame - candidate.timelineStartFrame);
			if (clips.every((clip) => clip === candidate
				|| clip.timelineStartFrame >= range.endFrame
				|| clip.timelineStartFrame + clip.durationFrames <= range.endFrame - available)) {
				endFrame -= available;
			}
		}
	}
	return { startFrame, endFrame, durationFrames: endFrame - startFrame };
}
