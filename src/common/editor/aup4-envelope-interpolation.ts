/* SPDX-License-Identifier: AGPL-3.0-only */

export interface AudacityEnvelopePoint {
	readonly frame: number;
	readonly value: number;
}

/** WaveClip envelopes interpolate amplitude exponentially, unlike editor envelopes. */
export function convertAudacityEnvelopeInterpolation(
	points: readonly AudacityEnvelopePoint[],
	startFrame: number,
	endFrame: number,
	direction: 'from-native' | 'to-native',
): AudacityEnvelopePoint[] {
	if (!points.length) return [];
	const frames = [...new Set([startFrame, ...points.map(({ frame }) => frame)
		.filter((frame) => frame > startFrame && frame < endFrame), endFrame])].sort((a, b) => a - b);
	const values = new Map<number, number>();
	const nativeInput = direction === 'from-native';
	for (let index = 1; index < frames.length; index += 1) {
		const left = frames[index - 1]!, right = frames[index]!;
		values.set(left, valueAt(left));
		subdivide(left, right, values.get(left)!, valueAt(right), 0);
	}
	values.set(endFrame, valueAt(endFrame));
	const output = [...values].sort(([a], [b]) => a - b).map(([frame, value]) => ({
		frame: frame - startFrame,
		value: nativeInput ? value : Math.max(1e-7, value),
	}));
	// A held final value needs no redundant endpoint in either format.
	if (output.length > 1 && output.at(-1)!.value === output.at(-2)!.value) output.pop();
	return output;

	function valueAt(frame: number): number {
		let low = 0, high = points.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if (points[middle]!.frame < frame) low = middle + 1;
			else high = middle;
		}
		if (low === 0) return points[0]!.value;
		if (low === points.length) return points.at(-1)!.value;
		const left = points[low - 1]!, right = points[low]!;
		return interpolate(left.value, right.value, (frame - left.frame) / (right.frame - left.frame), nativeInput);
	}

	function subdivide(left: number, right: number, leftValue: number, rightValue: number, depth: number): void {
		if (right - left <= 1 || depth >= 20 || values.size >= 65_536) return;
		const probes = [1 / 4, 1 / 2, 3 / 4].map((fraction) => Math.round(left + (right - left) * fraction))
			.filter((frame) => frame > left && frame < right);
		if (!probes.some((frame) => Math.abs(valueAt(frame)
			- interpolate(leftValue, rightValue, (frame - left) / (right - left), !nativeInput)) > 1e-4)) return;
		const middle = Math.round((left + right) / 2), middleValue = valueAt(middle);
		values.set(middle, middleValue);
		subdivide(left, middle, leftValue, middleValue, depth + 1);
		subdivide(middle, right, middleValue, rightValue, depth + 1);
	}
}

function interpolate(left: number, right: number, fraction: number, logarithmic: boolean): number {
	if (fraction <= 0) return left;
	if (fraction >= 1) return right;
	return logarithmic
		? Math.exp(Math.log(Math.max(1e-7, left)) * (1 - fraction) + Math.log(Math.max(1e-7, right)) * fraction)
		: left + (right - left) * fraction;
}
