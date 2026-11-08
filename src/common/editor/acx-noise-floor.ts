/* SPDX-License-Identifier: AGPL-3.0-only */

/** Quietest complete 400 ms RMS window, sampled every 100 ms, with constant storage. */
export function createAcxNoiseFloorAnalyzer(sampleRate: number) {
	const windowFrames = Math.round(sampleRate * 0.4);
	const stepFrames = Math.round(sampleRate * 0.1);
	// Independently accumulated overlapping windows avoid subtracting loud samples
	// from a rolling sum and losing the much quieter room tone to cancellation.
	const remaining = new Uint32Array(Math.ceil(windowFrames / stepFrames));
	const sums = new Float64Array(remaining.length);
	let frames = 0;
	let nextWindow = 0;
	let minimumPower = Infinity;
	return Object.freeze({
		pushFrame(meanSquare: number): void {
			if (frames % stepFrames === 0) {
				remaining[nextWindow] = windowFrames;
				sums[nextWindow] = 0;
				nextWindow = (nextWindow + 1) % remaining.length;
			}
			for (let index = 0; index < remaining.length; index += 1) {
				if (!remaining[index]) continue;
				sums[index] += meanSquare;
				remaining[index] -= 1;
				if (!remaining[index]) minimumPower = Math.min(minimumPower, sums[index] / windowFrames);
			}
			frames += 1;
		},
		finish(): number | null {
			return Number.isFinite(minimumPower) ? Math.max(-120, 10 * Math.log10(minimumPower)) : null;
		},
	});
}
