/* SPDX-License-Identifier: AGPL-3.0-only */
import { roundRational } from '../../../../timeline-time.ts';

export interface NativeAudioDataCounters { readonly discardedFrames: number; readonly totalFrames: number }

/** Native counters describe discarded media blocks, never individual PCM samples. */
export function readNativeAudioDataCounters(value: Readonly<{ discardedFrames?: number; totalFrames?: number }>): NativeAudioDataCounters | null {
	const discardedFrames = value.discardedFrames, totalFrames = value.totalFrames;
	if (discardedFrames === undefined || totalFrames === undefined) return null;
	if (!Number.isSafeInteger(discardedFrames) || discardedFrames < 0 || !Number.isSafeInteger(totalFrames)
		|| totalFrames < discardedFrames) throw new RangeError('Capture AudioData counters are invalid.');
	return { discardedFrames, totalFrames };
}

/** Count source samples exactly; timestamps locate native discarded-block evidence. */
export function createFramescaperAudioDataFrameClock(sampleRate: number) {
	let sharedStart: number | null = null, previousTimestamp: number | null = null;
	let previousFrames = 0, nextFrame: number | null = null, seenDiscarded: number | null = null;
	let seenTotal = 0, pendingDiscarded = 0;
	let reliableLossClock = true;
	return Object.freeze({
		start(frame: number, counters: NativeAudioDataCounters): void {
			if (counters.discardedFrames) throw new Error('Capture AudioData lost initial blocks before establishing its source clock.');
			sharedStart = frame; seenDiscarded = counters.discardedFrames; seenTotal = counters.totalFrames;
		},
		map(timestamp: number, frames: number, counters: NativeAudioDataCounters): number {
			if (sharedStart === null) throw new Error('Capture AudioData clock has not started.');
			if (!Number.isSafeInteger(timestamp)) throw new RangeError('Capture AudioData timestamp must be an exact microsecond point.');
			if (seenDiscarded !== null && (counters.discardedFrames < seenDiscarded || counters.totalFrames < seenTotal)) {
				throw new Error('Capture AudioData counters moved backward.');
			}
			pendingDiscarded += seenDiscarded === null ? 0 : counters.discardedFrames - seenDiscarded;
			if (previousTimestamp === null && pendingDiscarded) throw new Error('Capture AudioData lost initial blocks before establishing its source clock.');
			if (pendingDiscarded && frames !== previousFrames) throw new Error('Capture AudioData block format changed across discarded media.');
			// Chromium dequeues a frame and delivers it in another task. Counter
			// growth may therefore describe losses after an already-dequeued frame.
			// Rounded native block intervals locate that loss; only the counter and
			// fixed observed block size determine the exact number of missing samples.
			const timestampMissingBlocks = previousTimestamp === null ? 0 : roundRational(
				(BigInt(timestamp) - BigInt(previousTimestamp)) * BigInt(sampleRate),
				1_000_000n * BigInt(previousFrames), 'point') - 1;
			// Native FIFO order and zero discard evidence retain every PCM block.
			// WebAudio destinations timestamp estimated capture with TimeTicks::Now(),
			// so their wall-clock bursts must not reorder or shorten that PCM.
			if (!pendingDiscarded && timestampMissingBlocks !== 0) reliableLossClock = false;
			if (pendingDiscarded && !reliableLossClock) throw new Error('Capture AudioData loss has an unreliable timestamp clock; exact placement is ambiguous.');
			const missingBlocks = pendingDiscarded ? timestampMissingBlocks : 0;
			if (missingBlocks < 0) throw new Error('Capture AudioData timestamps overlap across discarded media.');
			if (missingBlocks > pendingDiscarded) throw new Error('Capture AudioData timestamp gap lacks native discard evidence.');
			const frameStart = (nextFrame ?? sharedStart) + missingBlocks * previousFrames;
			if (!Number.isSafeInteger(frameStart) || frameStart < 0 || !Number.isSafeInteger(frameStart + frames)) {
				throw new RangeError('Capture AudioData timestamp exceeds the source frame range.');
			}
			pendingDiscarded -= missingBlocks;
			nextFrame = frameStart + frames;
			previousTimestamp = timestamp; previousFrames = frames;
			seenDiscarded = counters.discardedFrames; seenTotal = counters.totalFrames;
			return frameStart;
		},
	});
}
