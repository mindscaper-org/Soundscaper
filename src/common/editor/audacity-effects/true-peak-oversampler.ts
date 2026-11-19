/* SPDX-License-Identifier: AGPL-3.0-only */

import { TRUE_PEAK_FACTOR, TRUE_PEAK_RADIUS as RADIUS } from './true-peak-limiter-parameters.ts';

const CENTER = RADIUS * TRUE_PEAK_FACTOR;
const LENGTH = CENTER * 2 + 1;

// Unity-DC Blackman-windowed sinc. Interpolation uses its four polyphase
// branches; decimation low-passes the limited signal before discarding samples.
const kernel = Float64Array.from({ length: LENGTH }, (_, tap) => {
	const position = (tap - CENTER) / TRUE_PEAK_FACTOR;
	const sinc = position === 0 ? 1 : Math.sin(Math.PI * position) / (Math.PI * position);
	return sinc * (.42 - .5 * Math.cos(2 * Math.PI * tap / (LENGTH - 1))
		+ .08 * Math.cos(4 * Math.PI * tap / (LENGTH - 1)));
});
const sum = kernel.reduce((total, value) => total + value, 0);
for (let tap = 0; tap < LENGTH; tap++) kernel[tap] = kernel[tap]! / sum;

/** Fixed-size histories survive arbitrary audio block boundaries. */
export class TruePeakOversampler {
	private readonly up: Float32Array[];
	private readonly down: Float32Array[];
	private upCursor = 0;
	private downCursor = 0;
	constructor(channelCount: number) {
		this.up = Array.from({ length: channelCount }, () => new Float32Array(RADIUS * 2 + 1));
		this.down = Array.from({ length: channelCount }, () => new Float32Array(LENGTH));
	}

	upsample(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void {
		for (let frame = 0; frame < frames; frame++) {
			for (let channel = 0; channel < output.length; channel++) {
				const history = this.up[channel]!;
				history[this.upCursor] = (input[channel] ?? input[0])?.[frame] ?? 0;
				for (let phase = 0; phase < TRUE_PEAK_FACTOR; phase++) {
					let value = 0;
					for (let tap = phase, age = 0; tap < LENGTH; tap += TRUE_PEAK_FACTOR, age++) {
						value += kernel[tap]! * history[(this.upCursor - age + history.length) % history.length]!;
					}
					output[channel]![frame * TRUE_PEAK_FACTOR + phase] = value * TRUE_PEAK_FACTOR;
				}
			}
			this.upCursor = (this.upCursor + 1) % this.up[0]!.length;
		}
	}

	downsample(input: readonly Float32Array[], output: readonly Float32Array[], phase: number): void {
		for (let frame = 0; frame < output[0]!.length * TRUE_PEAK_FACTOR; frame++) {
			for (let channel = 0; channel < output.length; channel++) {
				const history = this.down[channel]!;
				history[this.downCursor] = input[channel]![frame]!;
				if (frame % TRUE_PEAK_FACTOR !== phase) continue;
				let value = 0;
				for (let tap = 0; tap < LENGTH; tap++) {
					value += kernel[tap]! * history[(this.downCursor - tap + LENGTH) % LENGTH]!;
				}
				output[channel]![Math.floor(frame / TRUE_PEAK_FACTOR)] = value;
			}
			this.downCursor = (this.downCursor + 1) % LENGTH;
		}
	}
}
