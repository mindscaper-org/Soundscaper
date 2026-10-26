/* SPDX-License-Identifier: AGPL-3.0-only */

interface Projection {
	readonly width: number;
	readonly sampleRate: number;
	readonly nativeRate: number;
	readonly binCount: number;
	readonly intervals: readonly (readonly [number, number])[];
}

/** Two active analyser clocks share geometry while retaining bounded view-owned state. */
export function createSpectrumIntervalCache() {
	const projections: Projection[] = [];
	return (width: number, sampleRate: number, nativeRate: number, binCount: number) => {
		const retained = projections.find(entry => entry.width === width && entry.sampleRate === sampleRate
			&& entry.nativeRate === nativeRate && entry.binCount === binCount);
		if (retained) return retained.intervals;
		const maximum = Math.min(24_000, sampleRate * 0.49);
		const binAt = (pixel: number) => 10 * (maximum / 10) ** (pixel / Math.max(1, width - 1)) / (nativeRate / 2) * binCount;
		const intervals: Array<readonly [number, number]> = [];
		for (let pixel = 0; pixel < width; pixel += 2) {
			intervals.push([Math.max(0, Math.floor(binAt(pixel - 1))), Math.min(binCount, Math.ceil(binAt(pixel + 1)) + 1)]);
		}
		if (projections.length === 2) projections.shift();
		projections.push({ width, sampleRate, nativeRate, binCount, intervals });
		return intervals;
	};
}
