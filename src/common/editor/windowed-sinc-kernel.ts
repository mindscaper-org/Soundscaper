/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reuse one channel-independent window/filter kernel at each output position. */
export function createWindowedSincChannelSampler(radius: number, cutoff: number): (
	channels: readonly Float32Array[],
	bufferStartFrame: number,
	inputEndFrame: number,
	position: number,
	output: readonly Float32Array[],
	outputFrame: number,
) => void {
	const weights = new Float64Array(radius * 2);
	let integerWeights: Float64Array | null = null;
	let integerWeightSum = 0;
	let halfWeights: Float64Array | null = null;
	let halfWeightSum = 0;
	return (channels, bufferStartFrame, inputEndFrame, position, output, outputFrame) => {
		const center = Math.floor(position);
		const firstFrame = Math.max(center - radius + 1, 0, bufferStartFrame);
		let endFrame = Math.min(center + radius + 1, inputEndFrame, bufferStartFrame + channels[0]!.length);
		if (endFrame > firstFrame && Math.abs(position - (endFrame - 1)) / radius >= 1) endFrame--;
		const completeIntegerWindow = Number.isSafeInteger(position)
			&& Number.isSafeInteger(firstFrame) && Number.isSafeInteger(endFrame)
			&& firstFrame === center - radius + 1 && endFrame === center + radius;
		const completeHalfWindow = position - center === 0.5
			&& Number.isSafeInteger(firstFrame) && Number.isSafeInteger(endFrame)
			&& firstFrame === center - radius + 1 && endFrame === center + radius + 1;
		let selectedWeights = (completeIntegerWindow ? integerWeights : completeHalfWindow ? halfWeights : null) ?? weights;
		let weightSum = selectedWeights === integerWeights ? integerWeightSum : selectedWeights === halfWeights ? halfWeightSum : 0;
		for (let frame = firstFrame; selectedWeights === weights && frame < endFrame; frame++) {
			const distance = position - frame;
			const normalizedDistance = Math.abs(distance) / radius;
			const window = 0.5 + 0.5 * Math.cos(Math.PI * normalizedDistance);
			const argument = Math.PI * distance * cutoff;
			const sinc = argument === 0 ? 1 : Math.sin(argument) / argument;
			const weight = cutoff * sinc * window;
			weights[frame - firstFrame] = weight;
			weightSum += weight;
		}
		// Integer decimation and twofold upsampling revisit these exact phases.
		// Cache only complete windows; clipped edges retain their original math.
		if (completeIntegerWindow && !integerWeights) {
			integerWeights = weights.slice();
			integerWeightSum = weightSum;
			selectedWeights = integerWeights;
		}
		if (completeHalfWindow && !halfWeights) {
			halfWeights = weights.slice();
			halfWeightSum = weightSum;
			selectedWeights = halfWeights;
		}
		const firstIndex = firstFrame - bufferStartFrame;
		const taps = Math.max(0, endFrame - firstFrame);
		for (let channel = 0; channel < channels.length; channel++) {
			const samples = channels[channel]!;
			let weighted = 0;
			for (let tap = 0; tap < taps; tap++) weighted += samples[firstIndex + tap]! * selectedWeights[tap]!;
			output[channel]![outputFrame] = weightSum ? weighted / weightSum : 0;
		}
	};
}
