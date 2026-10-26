/* SPDX-License-Identifier: AGPL-3.0-only */

import { fftRadixTwoFloat64V1 } from './radix-two-fft-v1.ts';

/** Exact PyTorch-compatible signal geometry shared by the pinned assistance models. */
export const ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1 = 2_048;
export const ASSISTANCE_CENTERED_PERIODIC_HANN_HOP_FRAMES_V1 = 512;
export const ASSISTANCE_CENTERED_PERIODIC_HANN_FREQUENCY_BIN_COUNT_V1 = 1_025;

const MAXIMUM_RETAINED_NORMALIZATION_BYTES = 16 * 1024 * 1024;
let retainedInverseGeometry: Readonly<{ timeFrameCount: number; window: Float64Array; normalization: Float64Array }> | null = null;
const CENTER_PADDING_FRAMES = ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1 / 2;

export interface AssistanceCenteredPeriodicHannSpectrumChannelV1 {
	readonly real: Float32Array;
	readonly imaginary: Float32Array;
}

export interface AssistanceCenteredPeriodicHannStftChannelV1
	extends AssistanceCenteredPeriodicHannSpectrumChannelV1 {
	readonly frequencyBinCount: typeof ASSISTANCE_CENTERED_PERIODIC_HANN_FREQUENCY_BIN_COUNT_V1;
	readonly timeFrameCount: number;
}

/** Create one centered, reflected, periodic-Hann spectrum plane. */
export function centeredPeriodicHannStftChannelV1(
	channel: Float32Array,
): AssistanceCenteredPeriodicHannStftChannelV1 {
	if (!(channel instanceof Float32Array) || channel.length <= CENTER_PADDING_FRAMES) {
		throw new RangeError('Centered periodic-Hann STFT needs more than 1024 source frames.');
	}
	const timeFrameCount = Math.floor(channel.length
		/ ASSISTANCE_CENTERED_PERIODIC_HANN_HOP_FRAMES_V1) + 1;
	const window = periodicHannWindowFloat64V1();
	const realOutput = new Float32Array(
		timeFrameCount * ASSISTANCE_CENTERED_PERIODIC_HANN_FREQUENCY_BIN_COUNT_V1,
	);
	const imaginaryOutput = new Float32Array(realOutput.length);
	const real = new Float64Array(ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1);
	const imaginary = new Float64Array(ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1);
	for (let time = 0; time < timeFrameCount; time += 1) {
		imaginary.fill(0);
		const paddedStart = time * ASSISTANCE_CENTERED_PERIODIC_HANN_HOP_FRAMES_V1;
		for (let frame = 0; frame < ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1; frame += 1) {
			real[frame] = reflectedFloat32SampleV1(channel, paddedStart + frame - CENTER_PADDING_FRAMES)
				* window[frame]!;
		}
		fftRadixTwoFloat64V1(real, imaginary, false);
		for (let bin = 0; bin < ASSISTANCE_CENTERED_PERIODIC_HANN_FREQUENCY_BIN_COUNT_V1;
			bin += 1) {
			const offset = time * ASSISTANCE_CENTERED_PERIODIC_HANN_FREQUENCY_BIN_COUNT_V1 + bin;
			realOutput[offset] = real[bin]!;
			imaginaryOutput[offset] = imaginary[bin]!;
		}
	}
	return Object.freeze({
		frequencyBinCount: ASSISTANCE_CENTERED_PERIODIC_HANN_FREQUENCY_BIN_COUNT_V1,
		timeFrameCount,
		real: realOutput,
		imaginary: imaginaryOutput,
	});
}

/** Rebuild Hermitian planes and overlap-add one or more centered spectra. */
export function centeredPeriodicHannIstftChannelsV1(
	channels: readonly AssistanceCenteredPeriodicHannSpectrumChannelV1[],
	timeFrameCount: number,
	sourceFrameCount: number,
): readonly Float32Array[] {
	const expectedTimeFrameCount = Math.floor(sourceFrameCount
		/ ASSISTANCE_CENTERED_PERIODIC_HANN_HOP_FRAMES_V1) + 1;
	if (!Number.isSafeInteger(sourceFrameCount) || sourceFrameCount <= CENTER_PADDING_FRAMES
		|| timeFrameCount !== expectedTimeFrameCount || channels.length < 1) {
		throw new RangeError('Centered periodic-Hann ISTFT geometry is invalid.');
	}
	const tensorLength = timeFrameCount
		* ASSISTANCE_CENTERED_PERIODIC_HANN_FREQUENCY_BIN_COUNT_V1;
	for (const channel of channels) {
		if (!(channel.real instanceof Float32Array)
			|| !(channel.imaginary instanceof Float32Array)
			|| channel.real.length !== tensorLength
			|| channel.imaginary.length !== tensorLength) {
			throw new RangeError('Centered periodic-Hann spectrum geometry is invalid.');
		}
	}
	const paddedFrameCount = (timeFrameCount - 1)
		* ASSISTANCE_CENTERED_PERIODIC_HANN_HOP_FRAMES_V1
		+ ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1;
	const { window, normalization } = inverseGeometry(timeFrameCount, paddedFrameCount);
	return Object.freeze(channels.map((channel) => {
		const accumulator = new Float64Array(paddedFrameCount);
		const real = new Float64Array(ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1);
		const imaginary = new Float64Array(ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1);
		for (let time = 0; time < timeFrameCount; time += 1) {
			for (let bin = 0; bin < ASSISTANCE_CENTERED_PERIODIC_HANN_FREQUENCY_BIN_COUNT_V1;
				bin += 1) {
				const offset = time * ASSISTANCE_CENTERED_PERIODIC_HANN_FREQUENCY_BIN_COUNT_V1 + bin;
				real[bin] = channel.real[offset]!;
				imaginary[bin] = channel.imaginary[offset]!;
			}
			for (let bin = 1; bin < ASSISTANCE_CENTERED_PERIODIC_HANN_FREQUENCY_BIN_COUNT_V1 - 1;
				bin += 1) {
				real[ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1 - bin] = real[bin]!;
				imaginary[ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1 - bin] = -imaginary[bin]!;
			}
			fftRadixTwoFloat64V1(real, imaginary, true);
			const start = time * ASSISTANCE_CENTERED_PERIODIC_HANN_HOP_FRAMES_V1;
			for (let frame = 0; frame < ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1; frame += 1) {
				accumulator[start + frame]! += real[frame]! * window[frame]!;
			}
		}
		const result = new Float32Array(sourceFrameCount);
		for (let frame = 0; frame < sourceFrameCount; frame += 1) {
			const padded = CENTER_PADDING_FRAMES + frame;
			const divisor = normalization[padded]!;
			if (!(divisor > 0)) {
				throw new RangeError('Centered periodic-Hann ISTFT has an uncovered source frame.');
			}
			result[frame] = accumulator[padded]! / divisor;
		}
		return result;
	}));
}

/** Retain one private immutable coefficient shape; larger generic inputs keep fresh bounded-by-caller geometry. */
function inverseGeometry(timeFrameCount: number, paddedFrameCount: number) {
	if (retainedInverseGeometry?.timeFrameCount === timeFrameCount) return retainedInverseGeometry;
	const window = periodicHannWindowFloat64V1();
	const normalization = new Float64Array(paddedFrameCount);
	for (let time = 0; time < timeFrameCount; time += 1) {
		const start = time * ASSISTANCE_CENTERED_PERIODIC_HANN_HOP_FRAMES_V1;
		for (let frame = 0; frame < ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1; frame += 1) {
			normalization[start + frame]! += window[frame]! * window[frame]!;
		}
	}
	const geometry = Object.freeze({ timeFrameCount, window, normalization });
	if (normalization.byteLength <= MAXIMUM_RETAINED_NORMALIZATION_BYTES) retainedInverseGeometry = geometry;
	return geometry;
}

/** Create the exact periodic Hann window used by both model adapters. */
export function periodicHannWindowFloat64V1(): Float64Array {
	return Float64Array.from(
		{ length: ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1 },
		(_, frame) => 0.5 - 0.5 * Math.cos(
			2 * Math.PI * frame / ASSISTANCE_CENTERED_PERIODIC_HANN_FFT_SIZE_V1,
		),
	);
}

/** PyTorch-style reflection padding: reflect around, but do not repeat, each edge. */
export function reflectedFloat32SampleV1(channel: Float32Array, frame: number): number {
	if (channel.length < 2) {
		throw new RangeError('Reflection padding requires at least two source frames.');
	}
	let reflected = frame;
	while (reflected < 0 || reflected >= channel.length) {
		if (reflected < 0) reflected = -reflected;
		else reflected = 2 * channel.length - 2 - reflected;
	}
	return channel[reflected]!;
}
