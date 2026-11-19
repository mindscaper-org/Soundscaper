/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import { createSpectrumPlotProjector, SPECTRUM_PLOT_COLUMN_WIDTH } from '../../spectrum-plot-geometry.ts';
const EMPTY_BINS: readonly Readonly<{ db?: number }>[] = [];

export function useSpectrumPlotPoints(bins: Parameters<typeof spectrumPlotPoints>[0] = EMPTY_BINS) {
	return useMemo(() => spectrumPlotPoints(bins), [bins]);
}

export function spectrumPlotColumns(bins: readonly Readonly<{ db?: number }>[]): number[] {
	return createSpectrumPlotProjector(bins.length)(bin => Number(bins[bin]?.db));
}

export function spectrumPlotPoints(bins: readonly Readonly<{ db?: number }>[]): string {
	return spectrumPlotColumns(bins).map((y, index) => `${String(index * SPECTRUM_PLOT_COLUMN_WIDTH)},${String(y)}`).join(' ');
}
