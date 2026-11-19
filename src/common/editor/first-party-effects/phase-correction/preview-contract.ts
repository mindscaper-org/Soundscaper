/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhaseCorrectionAnalysis } from './selection.ts';

export interface PhaseCorrectionAuditionOptions {
	readonly source: 'original' | 'corrected';
	readonly mono: boolean;
}

export interface PhaseCorrectionPreviewReport {
	readonly trackName: string;
	readonly sampleRate: number;
	readonly analysis: PhaseCorrectionAnalysis;
}

/** The existing effect preview returns boolean for ordinary effects. */
export function phaseCorrectionPreviewReports(result: unknown): readonly PhaseCorrectionPreviewReport[] | null {
	if (!result || typeof result !== 'object' || !('phaseCorrectionAnalysis' in result)) return null;
	const reports = result.phaseCorrectionAnalysis;
	if (!Array.isArray(reports) || !reports.length) return null;
	for (const report of reports as unknown[]) {
		if (!report || typeof report !== 'object') return null;
		const value = report as Partial<PhaseCorrectionPreviewReport>;
		if (typeof value.trackName !== 'string' || !Number.isFinite(value.sampleRate) || Number(value.sampleRate) <= 0
			|| !value.analysis || !['correctable', 'aligned', 'uncertain'].includes(value.analysis.status)
			|| !Number.isFinite(value.analysis.lagSamples) || !Number.isFinite(value.analysis.confidence)) return null;
	}
	return reports as PhaseCorrectionPreviewReport[];
}
