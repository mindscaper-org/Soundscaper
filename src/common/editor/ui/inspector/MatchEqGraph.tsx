/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalCopyValue } from '../../../i18n/canonical-extras.js';
import { MATCH_EQ_FREQUENCIES, type MatchEqProfile } from '../../first-party-effects/match-eq/definition.ts';
import type { MatchEqPreviewReport } from '../../first-party-effects/match-eq/preview-contract.ts';
import './MatchEqGraph.css';

export default function MatchEqGraph({ reference, reports, copy }: Readonly<{
	reference: MatchEqProfile | null;
	reports: readonly MatchEqPreviewReport[] | null;
	copy: Readonly<Record<string, string>>;
}>) {
	const text = (key: string): string => canonicalCopyValue(key, copy);
	const report = reports?.length === 1 ? reports[0] : null;
	const x = (frequency: number): number => 40 + Math.log(frequency / 20) / Math.log(1000) * 560;
	const spectrum = (profile: MatchEqProfile): string => profile.bands
		.map((db, index) => `${String(x(MATCH_EQ_FREQUENCIES[index]!))},${String(20 - Math.max(-60, db) * 2)}`).join(' ');
	if (!reference) return null;
	return <figure className="audio-editor-match-eq-graph">
		<figcaption>{text('effectMatchEqSpectrum')}</figcaption>
		<svg viewBox="0 0 640 180" role="img" aria-label={text('effectMatchEqSpectrum')}>
			{[0, -20, -40, -60].map(db => <g key={db}><path className="audio-editor-match-eq-graph__grid" d={`M40 ${String(20 - db * 2)} H600`} />
				<text x={32} y={24 - db * 2} textAnchor="end">{db}</text></g>)}
			{[20, 100, 1000, 10000, 20000].map(frequency => <text key={frequency} x={x(frequency)} y={165} textAnchor="middle">{frequency}</text>)}
			<polyline className="audio-editor-match-eq-graph__reference" points={spectrum(reference)} />
			{report && <polyline className="audio-editor-match-eq-graph__target" points={spectrum(report.analysis.profile)} />}
		</svg>
		<div className="audio-editor-match-eq-graph__legend"><span>{text('effectMatchEqReference')}</span>{report && <span>{text('effectMatchEqTarget')}</span>}</div>
		{report && <><figcaption>{text('effectMatchEqCorrection')}</figcaption>
			<svg viewBox="0 0 640 150" role="img" aria-label={text('effectMatchEqCorrection')}>
				{[-18, 0, 18].map(db => <g key={db}><path className="audio-editor-match-eq-graph__grid" d={`M40 ${String(65 - db * 2.5)} H600`} />
					<text x={32} y={69 - db * 2.5} textAnchor="end">{db}</text></g>)}
				<polyline className="audio-editor-match-eq-graph__reference" points={report.analysis.curve.map(point => `${String(x(point.frequency))},${String(65 - point.gain * 2.5)}`).join(' ')} />
				{[20, 100, 1000, 10000, 20000].map(frequency => <text key={frequency} x={x(frequency)} y={135} textAnchor="middle">{frequency}</text>)}
			</svg></>}
	</figure>;
}
