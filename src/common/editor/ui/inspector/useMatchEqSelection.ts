/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';
import { matchEqPreviewReports, type MatchEqPreviewReport } from '../../first-party-effects/match-eq/preview-contract.ts';
import type { MatchEqProfile } from '../../first-party-effects/match-eq/definition.ts';

interface Effects {
	previewSelection(request: Readonly<Record<string, unknown>>): Promise<unknown>;
	setSelectionType(type: string): unknown;
	setSelectionParams(params: Readonly<Record<string, unknown>>): unknown;
	cancelPreview(): unknown;
}

/** The report belongs only to the current document, selection, and settings. */
export function useMatchEqSelection({ effects, project, reportKey, params, run, updateParams }: Readonly<{
	effects: Effects;
	project: object | null;
	reportKey: string;
	params: Readonly<Record<string, unknown>>;
	run: (work: () => unknown, onSuccess?: (result: unknown) => void) => Promise<unknown>;
	updateParams: (params: Readonly<Record<string, unknown>>) => void;
}>) {
	const [source, setSource] = useState<'original' | 'corrected'>('corrected');
	const [analysis, setAnalysis] = useState<Readonly<{ project: object | null; key: string; reports: readonly MatchEqPreviewReport[] }> | null>(null);
	const reports = analysis?.project === project && analysis?.key === reportKey ? analysis.reports : null;
	const remember = (result: unknown): void => {
		const next = matchEqPreviewReports(result);
		if (next) setAnalysis({ project, key: reportKey, reports: next });
	};
	return {
		source, reports,
		reference: (params.reference ?? null) as MatchEqProfile | null,
		remember,
		onSource: (next: 'original' | 'corrected'): void => { effects.cancelPreview(); setSource(next); },
		onLearn: (): void => { void run(() => effects.previewSelection({ type: 'match-eq', params, matchEq: { captureReference: true } }), result => {
			const next = matchEqPreviewReports(result);
			if (next?.length === 1) { updateParams({ reference: next[0]!.analysis.profile }); setAnalysis(null); }
		}); },
		onAnalyze: (): void => { void run(() => effects.previewSelection({ type: 'match-eq', params, matchEq: { analyzeOnly: true } }), remember); },
		onEdit: (): void => {
			if (reports?.length !== 1 || !reports[0]?.analysis.curve.length) return;
			const points = reports[0].analysis.curve;
			void run(async () => { effects.cancelPreview(); await effects.setSelectionType('audacity-filter-curve-eq');
				await effects.setSelectionParams({ points, filterLength: 8191, linearFrequencyScale: false }); });
		},
	};
}
