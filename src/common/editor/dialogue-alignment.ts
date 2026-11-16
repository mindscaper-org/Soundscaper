/* SPDX-License-Identifier: AGPL-3.0-only */

import { dialogueFeatures, dialogueFeatureDistance } from './dialogue-alignment-features.ts';

export const DIALOGUE_MAXIMUM_SECONDS = 30;
export interface DialogueAlignmentRequest {
	readonly reference: readonly Float32Array[];
	readonly replacement: readonly Float32Array[];
	readonly sampleRate: number;
	readonly strength: number;
}
export interface DialogueAlignmentPoint { readonly outputFrame: number; readonly sourceFrame: number }
export interface DialogueAlignment {
	readonly points: readonly DialogueAlignmentPoint[];
	readonly outputFrames: number;
	readonly inputFrames: number;
	/** Acoustic mismatch, not a probability of correct speech recognition. */
	readonly mismatch: number;
}

/** Bounded, slope-constrained acoustic DTW. No transcript, network or model is needed. */
export function analyzeDialogueAlignment(request: DialogueAlignmentRequest): DialogueAlignment {
	validateDialoguePcm(request.reference, request.sampleRate);
	validateDialoguePcm(request.replacement, request.sampleRate);
	if (!Number.isFinite(request.strength) || request.strength < 0 || request.strength > 1) throw new RangeError('Invalid dialogue alignment strength.');
	const outputFrames = request.reference[0]!.length, inputFrames = request.replacement[0]!.length;
	if (inputFrames / outputFrames < .5 || inputFrames / outputFrames > 2) throw new RangeError('Dialogue durations must be within a factor of two.');
	const reference = dialogueFeatures(request.reference, request.sampleRate), replacement = dialogueFeatures(request.replacement, request.sampleRate);
	const n = reference.count, m = replacement.count, width = m + 1;
	const back = new Uint8Array((n + 1) * width), rows = Array.from({ length: 3 }, () => new Float64Array(width).fill(Infinity));
	rows[0]![0] = 0;
	const steps = [[1, 1], [1, 2], [2, 1]] as const;
	for (let i = 1; i <= n; i++) {
		const row = rows[i % 3]!; row.fill(Infinity);
		for (let j = Math.max(1, Math.floor(i * m / n - m * .3)); j <= Math.min(m, Math.ceil(i * m / n + m * .3)); j++) {
			const distance = dialogueFeatureDistance(reference, i - 1, replacement, j - 1);
			for (const [index, [di, dj]] of steps.entries()) {
				if (i < di || j < dj) continue;
				const extra = di === 2 ? dialogueFeatureDistance(reference, i - 2, replacement, j - 1)
					: dj === 2 ? dialogueFeatureDistance(reference, i - 1, replacement, j - 2) : 0;
				const cost = rows[(i - di) % 3]![j - dj]! + distance * 2 + extra + (di === dj ? 0 : .025);
				if (cost < row[j]!) { row[j] = cost; back[i * width + j] = index + 1; }
			}
		}
	}
	if (!Number.isFinite(rows[n % 3]![m])) throw new RangeError('The dialogue cannot be aligned within the stretch limits.');
	const mismatch = rows[n % 3]![m]! / (n + m);
	if (mismatch > .4) throw new RangeError('The dialogue recordings are not sufficiently similar.');
	const points: DialogueAlignmentPoint[] = [];
	for (let i = n, j = m; i > 0 && j > 0;) {
		const outputFrame = i * outputFrames / n, uniform = outputFrame * inputFrames / outputFrames;
		points.push({ outputFrame, sourceFrame: uniform + request.strength * (j * inputFrames / m - uniform) });
		const step = steps[back[i * width + j]! - 1];
		if (!step) throw new RangeError('Incomplete dialogue alignment path.');
		i -= step[0]; j -= step[1];
	}
	points.push({ outputFrame: 0, sourceFrame: 0 }); points.reverse();
	// Partial final feature windows must not make an otherwise legal DTW step
	// exceed the real PCM slope bounds. Preserve reachability of the exact end.
	for (let index = 1; index < points.length; index++) {
		const previous = points[index - 1]!, point = points[index]!;
		const delta = point.outputFrame - previous.outputFrame, remaining = outputFrames - point.outputFrame;
		const minimum = Math.max(previous.sourceFrame + .5 * delta, inputFrames - 2 * remaining);
		const maximum = Math.min(previous.sourceFrame + 2 * delta, inputFrames - .5 * remaining);
		points[index] = { outputFrame: point.outputFrame, sourceFrame: Math.min(maximum, Math.max(minimum, point.sourceFrame)) };
	}
	return { points, outputFrames, inputFrames, mismatch };
}

export function dialogueSourceAtOutput(alignment: DialogueAlignment, frame: number): number {
	let low = 0, high = alignment.points.length - 1;
	while (high - low > 1) {
		const middle = (high + low) >>> 1;
		if (alignment.points[middle]!.outputFrame > frame) high = middle; else low = middle;
	}
	const left = alignment.points[low]!, right = alignment.points[high]!;
	return left.sourceFrame + (right.sourceFrame - left.sourceFrame) * (frame - left.outputFrame) / (right.outputFrame - left.outputFrame);
}

export function validateDialoguePcm(channels: readonly Float32Array[], rate: number): void {
	if (!Number.isSafeInteger(rate) || rate < 8000 || rate > 192000) throw new RangeError('Unsupported dialogue sample rate.');
	if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) throw new RangeError('Dialogue requires mono or stereo audio.');
	const length = channels[0]?.length ?? 0;
	if (length < rate * .25 || length > rate * DIALOGUE_MAXIMUM_SECONDS) throw new RangeError('Select dialogue between 0.25 and 30 seconds long.');
	if (channels.some(channel => !(channel instanceof Float32Array) || channel.length !== length)) throw new RangeError('Dialogue channel lengths must match.');
}
