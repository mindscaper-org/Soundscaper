/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CSSProperties, ReactNode } from 'react';
import type { SpectrumCurveReport, SpectrumPlotReport } from '../../controller/analysis/live-spectrum-session.ts';
import { formatDb } from './inspector-helpers.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';
import { resolveAudioEditorColor } from '../timeline/TimelineOverlayComponents.jsx';
import '../dialogs/analysis-dialog.css';

type Copy = Readonly<Record<string, string>>;

export default function SpectrumResult({ report, copy, children }: { readonly report: SpectrumPlotReport; readonly copy: Copy; readonly children: ReactNode }) {
	const tracks = report.tracks?.length ? report.tracks : null;
	return <section className="audio-editor-analysis-report" data-analysis-report="spectrum">
		<h4>{copy.plotSpectrum}</h4>
		{children}
		{tracks ? <ul className="audio-editor-analysis-dialog__legend">{tracks.map(track =>
			<li key={track.trackId} style={spectrumTrackStyle(track.color)}><strong>{track.name}</strong> · <SpectrumPeak report={track} copy={copy} /></li>)}</ul>
			: <p><strong><SpectrumPeak report={report} copy={copy} /></strong></p>}
		<p>{formatLocalizedTemplate(copy.spectrumConfiguration, { size: report.size, sampleRate: report.sampleRate })}</p>
	</section>;
}

function spectrumTrackStyle(color?: string): CSSProperties | undefined {
	return color ? { '--spectrum-color': `var(--clip-${resolveAudioEditorColor(color)}-header)` } as CSSProperties : undefined;
}

function SpectrumPeak({ report, copy }: { readonly report: SpectrumCurveReport; readonly copy: Copy }) {
	return formatLocalizedTemplate(copy.spectrumPeakDetail, {
		label: copy.spectrumPeak, frequency: Number(report.peak?.frequency || 0).toFixed(1),
		level: formatDb(report.peak?.db, 'dB'),
	});
}
