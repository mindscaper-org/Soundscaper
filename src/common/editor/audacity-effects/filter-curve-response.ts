/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Actual FIR response adapted from EqualizationPanel.cpp, Audacity
 * 5ef610ed23260d6d648175735bb16b32536eb30b. Mitch Golden, Vaughan Johnson,
 * Martyn Shaw, Paul Licameli; GPL-2.0-or-later, version 3 selected.
 * Browser adaptation for kw.media, 2026.
 */
import { initializePffft } from '../pffft.js';
import { buildEqualizationKernel } from './spectral-equalization-curves.js';
import { filterCurveGain, type FilterCurvePoint } from './filter-curve.ts';

interface ResponseBasis {
	readonly kernelLength: number;
	readonly sampleRate: number;
	readonly frequencies: readonly number[];
	readonly cosines: readonly Float64Array[];
}
// The displayed geometry is shared across coefficient edits; retain one bounded plan.
const MAXIMUM_BASIS_BYTES = 16 * 1024 * 1024;
let retainedBasis: ResponseBasis | null = null;

/** The symmetric FIR's cosine response, including frequencies between FFT bins. */
export function filterCurveKernelGain(kernel: ArrayLike<number>, frequency: number, sampleRate: number): number {
	const half = (kernel.length - 1) / 2;
	const theta = 2 * Math.PI * frequency / sampleRate;
	const sine = Math.sin(theta / 2);
	const realStep = -2 * sine * sine;
	const imaginaryStep = -Math.sin(theta);
	let real = Math.cos(theta * half);
	let imaginary = Math.sin(theta * half);
	let gain = kernel[half]!;
	for (let tap = 0; tap < half; tap += 1) {
		gain += 2 * kernel[tap]! * real;
		const previous = real;
		real += real * realStep - imaginary * imaginaryStep;
		imaginary += imaginary * realStep + previous * imaginaryStep;
	}
	return 20 * Math.log10(Math.max(1e-12, Math.abs(gain)));
}

export async function filterCurveResponse(
	points: readonly FilterCurvePoint[], sampleRate: number, filterLength: number,
	linearFrequencyScale: boolean, frequencies: readonly number[],
): Promise<readonly FilterCurvePoint[]> {
	await initializePffft();
	const kernel = buildEqualizationKernel(sampleRate, filterLength,
		(frequency: number) => filterCurveGain(points, frequency, linearFrequencyScale));
	const basis = responseBasis(kernel.length, sampleRate, frequencies);
	return frequencies.map((frequency, index) => ({
		frequency, gain: basis ? gainFromBasis(kernel, basis.cosines[index]!) : filterCurveKernelGain(kernel, frequency, sampleRate),
	}));
}

function responseBasis(kernelLength: number, sampleRate: number, frequencies: readonly number[]): ResponseBasis | null {
	const half = (kernelLength - 1) / 2;
	if (!Number.isSafeInteger(half) || half < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0
		|| frequencies.length > 1_024 || frequencies.length * (half + 1) * Float64Array.BYTES_PER_ELEMENT > MAXIMUM_BASIS_BYTES
		|| frequencies.some(frequency => !Number.isFinite(frequency))) return null;
	if (retainedBasis?.kernelLength === kernelLength && retainedBasis.sampleRate === sampleRate
		&& retainedBasis.frequencies.length === frequencies.length
		&& frequencies.every((frequency, index) => Object.is(frequency, retainedBasis!.frequencies[index]))) return retainedBasis;
	const cosines = frequencies.map(frequency => {
		const values = new Float64Array(half);
		const theta = 2 * Math.PI * frequency / sampleRate;
		const sine = Math.sin(theta / 2);
		const realStep = -2 * sine * sine;
		const imaginaryStep = -Math.sin(theta);
		let real = Math.cos(theta * half);
		let imaginary = Math.sin(theta * half);
		for (let tap = 0; tap < half; tap += 1) {
			values[tap] = real;
			const previous = real;
			real += real * realStep - imaginary * imaginaryStep;
			imaginary += imaginary * realStep + previous * imaginaryStep;
		}
		return values;
	});
	retainedBasis = { kernelLength, sampleRate, frequencies: [...frequencies], cosines };
	return retainedBasis;
}

function gainFromBasis(kernel: ArrayLike<number>, values: Float64Array): number {
	let gain = kernel[values.length]!;
	for (let tap = 0; tap < values.length; tap += 1) gain += 2 * kernel[tap]! * values[tap]!;
	return 20 * Math.log10(Math.max(1e-12, Math.abs(gain)));
}
