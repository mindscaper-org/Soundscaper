/* SPDX-License-Identifier: AGPL-3.0-only */

/** Whole sequence frames available inside an exact integer generator source window. */
export function generatorSourceWindowSequenceFrames(
	remainingSourceFrames: number,
	window: Readonly<{ sourceFrameCount: number; sequenceFrameCount: number }>,
): number {
	if (!Number.isSafeInteger(remainingSourceFrames) || remainingSourceFrames < 0
		|| !Number.isSafeInteger(window.sourceFrameCount) || window.sourceFrameCount < 1
		|| !Number.isSafeInteger(window.sequenceFrameCount) || window.sequenceFrameCount < 1) {
		throw new RangeError('A generator source window requires whole positive frame counts.');
	}
	const frames = Number(BigInt(remainingSourceFrames) * BigInt(window.sequenceFrameCount)
		/ BigInt(window.sourceFrameCount));
	if (!Number.isSafeInteger(frames)) throw new RangeError('The generator source window exceeds the safe frame range.');
	return frames;
}
