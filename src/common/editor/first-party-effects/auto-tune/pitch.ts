/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUTO_TUNE_KEYS, type AutoTuneKey, type AutoTuneScale } from './definition.ts';

const SCALES = {
	chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
	major: [0, 2, 4, 5, 7, 9, 11],
	minor: [0, 2, 3, 5, 7, 8, 10],
} as const;

export function nearestAutoTuneNote(midi: number, key: AutoTuneKey, scale: AutoTuneScale): number {
	const root = AUTO_TUNE_KEYS.indexOf(key);
	let nearest = 0, distance = Infinity;
	for (let note = Math.floor(midi) - 2; note <= Math.ceil(midi) + 2; note++) {
		const pitchClass = ((note - root) % 12 + 12) % 12;
		if (!SCALES[scale].some(value => value === pitchClass)) continue;
		const next = Math.abs(note - midi);
		if (next < distance) { nearest = note; distance = next; }
	}
	return nearest;
}

/** YIN-style cumulative normalized difference, bounded to solo voices and
 * melody instruments (65–1500 Hz). Box averaging before decimation limits
 * high-frequency energy. Analyze the strongest channel so opposite-phase
 * stereo cannot cancel the pitch; every output channel shares the result.
 * The returned zero denotes silence, an unvoiced window or insufficient audio.
 */
export function createAutoTunePitchDetector(channels: readonly Float32Array[], sampleRate: number): (frame: number) => number {
	const stride = Math.max(1, Math.floor(sampleRate / 8000));
	const rate = sampleRate / stride;
	const maximumLag = Math.ceil(rate / 65);
	const size = maximumLag * 2;
	const span = size * stride;
	const samples = new Float64Array(size), candidate = new Float64Array(size);
	const difference = new Float64Array(maximumLag + 1);
	const rawDifference = new Float64Array(maximumLag + 1);
	return (frame) => {
		if (channels[0].length < span) return 0;
		const start = Math.min(channels[0].length - span, Math.max(0, Math.round(frame - span / 2)));
		let strongest = 0;
		for (const channel of channels) {
			let mean = 0;
			for (let index = 0; index < size; index++) {
				let sum = 0;
				for (let offset = 0; offset < stride; offset++) sum += channel[start + index * stride + offset];
				candidate[index] = sum / stride;
				mean += candidate[index];
			}
			mean /= size;
			let energy = 0;
			for (let index = 0; index < size; index++) { candidate[index] -= mean; energy += candidate[index] ** 2; }
			if (energy > strongest) { strongest = energy; samples.set(candidate); }
		}
		if (strongest / size < 1e-5) return 0;
		let cumulative = 0;
		for (let lag = 1; lag <= maximumLag; lag++) {
			let sum = 0;
			for (let index = 0; index < maximumLag; index++) sum += (samples[index] - samples[index + lag]) ** 2;
			cumulative += sum;
			rawDifference[lag] = sum;
			difference[lag] = cumulative > 0 ? sum * lag / cumulative : 1;
		}
		// Check shorter periods too: skipping them can mistake an above-range
		// tone's second period for an in-range fundamental.
		for (let lag = 2; lag < maximumLag; lag++) {
			if (difference[lag] >= .15) continue;
			while (lag < maximumLag - 1 && difference[lag + 1] < difference[lag]) lag++;
			const left = rawDifference[lag - 1], middle = rawDifference[lag], right = rawDifference[lag + 1];
			const curvature = left - 2 * middle + right;
			const refined = lag + (curvature > 0 ? Math.max(-.5, Math.min(.5, .5 * (left - right) / curvature)) : 0);
			const frequency = rate / refined;
			return frequency >= 65 && frequency <= 1500 ? frequency : 0;
		}
		return 0;
	};
}
