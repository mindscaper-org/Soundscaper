/* SPDX-License-Identifier: AGPL-3.0-only */

import { fft } from '../../pffft.js';

export interface PhaseWindowEstimate {
	readonly lag: number;
	readonly confidence: number;
	readonly reliable: boolean;
}

/** Linear normalized cross-correlation; positive lag means that right arrives late. */
export function createPhaseWindowEstimator(frames: number, maximumLag: number) {
	let size = 32;
	while (size < frames * 2) size *= 2;
	const lr = new Float64Array(size), li = new Float64Array(size);
	const rr = new Float64Array(size), ri = new Float64Array(size);
	const lp = new Float64Array(frames + 1), rp = new Float64Array(frames + 1);
	const limit = Math.min(maximumLag, Math.floor(frames / 4));
	const offset = limit + 16;
	const correlations = new Float64Array(offset * 2 + 1);
	const halfWindow = frames / 2;
	return function estimate(left: Float32Array, right: Float32Array, start: number): PhaseWindowEstimate | null {
		let lm = 0, rm = 0;
		for (let frame = 0; frame < frames; frame++) { lm += left[start + frame]!; rm += right[start + frame]!; }
		lm /= frames; rm /= frames;
		for (let frame = 0; frame < frames; frame++) {
			lr[frame] = left[start + frame]! - lm;
			rr[frame] = right[start + frame]! - rm;
			lp[frame + 1] = lp[frame]! + lr[frame]! ** 2;
			rp[frame + 1] = rp[frame]! + rr[frame]! ** 2;
		}
		if (Math.min(lp[frames]!, rp[frames]!) / frames < 1e-10) return null;
		lr.fill(0, frames); rr.fill(0, frames);
		li.fill(0); ri.fill(0);
		fft(lr, li); fft(rr, ri);
		for (let bin = 0; bin < size; bin++) {
			const real = lr[bin]! * rr[bin]! + li[bin]! * ri[bin]!;
			li[bin] = li[bin]! * rr[bin]! - lr[bin]! * ri[bin]!;
			lr[bin] = real;
		}
		fft(lr, li, true);
		let bestLag = 0, best = -1, negative = 0;
		for (let lag = -limit; lag <= limit; lag++) {
			const value = correlation(lag);
			correlations[lag + offset] = value;
			if (value > best) { best = value; bestLag = lag; }
			negative = Math.max(negative, -value);
		}
		// A second distinct peak means that periodic content cannot establish a unique delay.
		let competing = -1;
		for (let lag = -limit + 1; lag < limit; lag++) {
			if (Math.abs(lag - bestLag) <= 2) continue;
			const index = lag + offset;
			const value = correlations[index]!;
			if (value >= correlations[index - 1]! && value >= correlations[index + 1]!) competing = Math.max(competing, value);
		}
		const reliable = Math.abs(bestLag) < limit && negative < best + .02 && competing < best - .03;
		if (!reliable) return { lag: bestLag, confidence: Math.max(0, Math.min(1, best)), reliable: false };
		let lower = Math.max(-limit, bestLag - .75), upper = Math.min(limit, bestLag + .75);
		for (let lag = Math.max(1 - halfWindow, Math.ceil(lower) - 16); lag < -limit; lag++) correlations[lag + offset] = correlation(lag);
		for (let lag = limit + 1, end = Math.min(halfWindow - 1, Math.floor(upper) + 16); lag <= end; lag++) correlations[lag + offset] = correlation(lag);
		for (let iteration = 0; iteration < 20; iteration++) {
			const a = lower + (upper - lower) / 3, b = upper - (upper - lower) / 3;
			if (interpolate(a) < interpolate(b)) lower = a; else upper = b;
		}
		const lag = (lower + upper) / 2;
		return { lag: Math.abs(lag - Math.round(lag)) < .025 ? Math.round(lag) : lag,
			confidence: Math.max(0, Math.min(1, interpolate(lag))), reliable };

	};

	function correlation(lag: number): number {
		const a = lag < 0 ? lp[frames]! - lp[-lag]! : lp[frames - lag]!;
		const b = lag < 0 ? rp[frames + lag]! : rp[frames]! - rp[lag]!;
		const index = lag <= 0 ? -lag : size - lag;
		return lr[index]! / Math.sqrt(Math.max(1e-30, a * b));
	}

	// Sinc interpolation resolves sub-sample offsets without the wideband
	// bias of a three-point parabolic fit.
	function interpolate(position: number): number {
		let sum = 0, weights = 0;
		for (let tap = Math.max(1 - halfWindow, Math.ceil(position) - 16), end = Math.min(halfWindow - 1, Math.floor(position) + 16); tap <= end; tap++) {
			const distance = position - tap;
			const argument = Math.PI * distance;
			const weight = (argument === 0 ? 1 : Math.sin(argument) / argument) * (.5 + .5 * Math.cos(argument / 16));
			sum += correlations[tap + offset]! * weight; weights += weight;
		}
		return sum / weights;
	}
}
