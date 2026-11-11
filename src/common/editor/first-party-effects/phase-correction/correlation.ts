/* SPDX-License-Identifier: AGPL-3.0-only */

import { fft } from '../../pffft.js';

export interface PhaseWindowEstimate {
	readonly lag: number;
	readonly confidence: number;
	readonly reliable: boolean;
}

/** Linear normalized cross-correlation; positive lag means that right arrives late. */
export function estimatePhaseWindow(left: Float32Array, right: Float32Array, start: number,
	frames: number, maximumLag: number): PhaseWindowEstimate | null {
	let size = 32;
	while (size < frames * 2) size *= 2;
	const lr = new Float64Array(size), li = new Float64Array(size);
	const rr = new Float64Array(size), ri = new Float64Array(size);
	const lp = new Float64Array(frames + 1), rp = new Float64Array(frames + 1);
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
	fft(lr, li); fft(rr, ri);
	for (let bin = 0; bin < size; bin++) {
		const real = lr[bin]! * rr[bin]! + li[bin]! * ri[bin]!;
		li[bin] = li[bin]! * rr[bin]! - lr[bin]! * ri[bin]!;
		lr[bin] = real;
	}
	fft(lr, li, true);
	const limit = Math.min(maximumLag, Math.floor(frames / 4));
	const correlation = (lag: number): number => {
		const a = lag < 0 ? lp[frames]! - lp[-lag]! : lp[frames - lag]!;
		const b = lag < 0 ? rp[frames + lag]! : rp[frames]! - rp[lag]!;
		return lr[(size - lag) % size]! / Math.sqrt(Math.max(1e-30, a * b));
	};
	let bestLag = 0, best = -1, negative = 0;
	for (let lag = -limit; lag <= limit; lag++) {
		const value = correlation(lag);
		if (value > best) { best = value; bestLag = lag; }
		negative = Math.max(negative, -value);
	}
	// A second distinct peak means that periodic content cannot establish a unique delay.
	let competing = -1;
	for (let lag = -limit + 1; lag < limit; lag++) {
		if (Math.abs(lag - bestLag) <= 2) continue;
		const value = correlation(lag);
		if (value >= correlation(lag - 1) && value >= correlation(lag + 1)) competing = Math.max(competing, value);
	}
	const reliable = Math.abs(bestLag) < limit && negative < best + .02 && competing < best - .03;
	if (!reliable) return { lag: bestLag, confidence: Math.max(0, Math.min(1, best)), reliable: false };
	// Sinc interpolation of the correlation resolves sub-sample offsets without
	// the wideband bias of a three-point parabolic fit.
	const interpolate = (position: number): number => {
		let sum = 0, weights = 0;
		for (let tap = Math.ceil(position) - 16; tap <= Math.floor(position) + 16; tap++) {
			if (Math.abs(tap) >= frames / 2) continue;
			const distance = position - tap;
			const argument = Math.PI * distance;
			const weight = (argument === 0 ? 1 : Math.sin(argument) / argument) * (.5 + .5 * Math.cos(argument / 16));
			sum += correlation(tap) * weight; weights += weight;
		}
		return sum / weights;
	};
	let lower = Math.max(-limit, bestLag - .75), upper = Math.min(limit, bestLag + .75);
	for (let iteration = 0; iteration < 20; iteration++) {
		const a = lower + (upper - lower) / 3, b = upper - (upper - lower) / 3;
		if (interpolate(a) < interpolate(b)) lower = a; else upper = b;
	}
	const lag = (lower + upper) / 2;
	return { lag: Math.abs(lag - Math.round(lag)) < .025 ? Math.round(lag) : lag,
		confidence: Math.max(0, Math.min(1, interpolate(lag))), reliable };
}
