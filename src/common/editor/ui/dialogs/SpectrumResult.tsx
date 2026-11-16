/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CSSProperties } from 'react';
import type { SpectrumCurveReport } from '../../controller/analysis/live-spectrum-session.ts';
import { formatDb } from '../inspector/inspector-helpers.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';
import { resolveAudioEditorColor } from '../timeline/TimelineOverlayComponents.jsx';
import { useSpectrumPlotPoints } from './spectrum-plot-points.ts';

interface SpectrumReport extends SpectrumCurveReport {
	readonly size: number;
	readonly sampleRate: number;
	readonly tracks?: readonly SpectrumCurveReport[];
}
type Copy = Readonly<Record<string, string>>;

export default function SpectrumResult({ report, copy }: { readonly report: SpectrumReport; readonly copy: Copy }) {
	const tracks = report.tracks?.length ? report.tracks : null;
	return <section className="audio-editor-analysis-report" data-analysis-report="spectrum">
		<h4>{copy.plotSpectrum}</h4>
		<svg className="audio-editor-analysis-dialog__plot" viewBox="0 0 635 150" role="img" aria-label={copy.plotSpectrum} data-analysis-spectrum>
			{tracks ? tracks.map(track => <SpectrumCurve key={track.trackId} report={track} />) : <SpectrumCurve report={report} />}
		</svg>
		{tracks ? <ul className="audio-editor-analysis-dialog__legend">{tracks.map(track =>
			<li key={track.trackId} style={spectrumTrackStyle(track.color)}><strong>{track.name}</strong> · <SpectrumPeak report={track} copy={copy} /></li>)}</ul>
			: <p><strong><SpectrumPeak report={report} copy={copy} /></strong></p>}
		<p>{formatLocalizedTemplate(copy.spectrumConfiguration, { size: report.size, sampleRate: report.sampleRate })}</p>
	</section>;
}

function spectrumTrackStyle(color?: string): CSSProperties | undefined {
	return color ? { '--spectrum-color': `var(--clip-${resolveAudioEditorColor(color)}-header)` } as CSSProperties : undefined;
}

function SpectrumCurve({ report }: { readonly report: SpectrumCurveReport }) {
	const points = useSpectrumPlotPoints(report.bins);
	return <polyline points={points} style={spectrumTrackStyle(report.color)} data-spectrum-track-id={report.trackId}>
		{report.name && <title>{report.name}</title>}
	</polyline>;
}

function SpectrumPeak({ report, copy }: { readonly report: SpectrumCurveReport; readonly copy: Copy }) {
	return formatLocalizedTemplate(copy.spectrumPeakDetail, {
		label: copy.spectrumPeak, frequency: Number(report.peak?.frequency || 0).toFixed(1),
		level: formatDb(report.peak?.db, 'dB'),
	});
}
