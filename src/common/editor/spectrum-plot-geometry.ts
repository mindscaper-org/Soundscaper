/* SPDX-License-Identifier: AGPL-3.0-only */

const COLUMN_COUNT = 128;
export const SPECTRUM_PLOT_COLUMN_WIDTH = 5;
export const SPECTRUM_PLOT_WIDTH = (COLUMN_COUNT - 1) * SPECTRUM_PLOT_COLUMN_WIDTH;
export const SPECTRUM_PLOT_HEIGHT = 150;

/** Reduce logarithmic display columns by their maximum so narrow tones remain visible. */
export function createSpectrumPlotProjector(binCount: number): (readDb: (bin: number) => number) => number[] {
	const last = Math.max(0, binCount - 1);
	const ranges = Array.from({ length: COLUMN_COUNT }, (_, column) => {
		const start = column === 0 ? 0 : Math.round(last ** ((column - .5) / (COLUMN_COUNT - 1)));
		const end = column === COLUMN_COUNT - 1 ? binCount : Math.round(last ** ((column + .5) / (COLUMN_COUNT - 1)));
		return { start, end: Math.min(binCount, Math.max(start + 1, end)) };
	});
	return readDb => ranges.map(({ start, end }) => {
		let peakDb = -120;
		for (let bin = start; bin < end; bin++) {
			const db = readDb(bin);
			if (Number.isFinite(db)) peakDb = Math.max(peakDb, db);
		}
		return peakDb >= 0 ? 0 : Math.round(-peakDb / 120 * SPECTRUM_PLOT_HEIGHT);
	});
}
