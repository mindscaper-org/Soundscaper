/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';
import { observeLivePlaybackSpectrum, observeSelectedSpectrum, type SpectrumPlotReport } from '../../controller/analysis/live-spectrum-session.ts';
import type { EnginePublicApi } from '../../engine/public-api.ts';
import { resolveSelectionRange } from '../../selection-range.ts';
import { spectrumPlotPoints } from '../dialogs/spectrum-plot-points.ts';
import { resolveAudioEditorColor } from '../timeline/TimelineOverlayComponents.jsx';
import SpectrumResult from './SpectrumResult.tsx';

interface Props {
	readonly controller: {
		readonly engine: Pick<EnginePublicApi, 'acquirePlaybackSpectrum' | 'getPositionFrames'>;
		readonly actions: { readonly analysis: { plotSpectrum(scope: string): Promise<unknown> } };
	};
	readonly snapshot?: {
		readonly ready?: boolean;
		readonly project?: { readonly id: string; readonly revision?: number; readonly sampleRate: number;
			readonly clips: readonly unknown[];
			readonly tracks: readonly { readonly id: string; readonly type: string; readonly name?: string; readonly color?: string; readonly clipIds?: readonly string[] }[] } | null;
		readonly selectedClipId?: string | null;
		readonly importing?: boolean;
		readonly recording?: boolean;
		readonly exporting?: boolean;
		readonly missingSourceIds?: readonly string[];
		readonly preferences?: { readonly spectrogram?: { readonly windowSize?: number } };
	};
	readonly copy: Readonly<Record<string, string>>;
}

export type AnalysisSpectrumSnapshot = Props['snapshot'];

export default function AnalysisSpectrumPanel(props: Props) {
	const { snapshot } = props;
	const range = resolveSelectionRange(snapshot?.project, { selectedClipId: snapshot?.selectedClipId ?? null });
	const key = JSON.stringify([snapshot?.project?.id, snapshot?.project?.revision, range,
		snapshot?.preferences?.spectrogram?.windowSize]);
	return <SpectrumContent key={key} {...props} selected={Boolean(range)} />;
}

function SpectrumContent({ controller, snapshot, copy, selected }: Props & { readonly selected: boolean }) {
	const project = snapshot?.project;
	const tracks = useMemo(() => project?.tracks.filter(track => track.type === 'audio' && track.clipIds?.length)
		.map(track => ({ id: track.id, name: track.name ?? track.id, color: track.color ?? 'blue' })) ?? [], [project?.tracks]);
	const [report, setReport] = useState<SpectrumPlotReport | null>(null);
	const [error, setError] = useState('');
	const ready = Boolean(snapshot?.ready && project?.clips.length && !snapshot.importing && !snapshot.recording
		&& !snapshot.exporting && !snapshot.missingSourceIds?.length);
	useEffect(() => {
		if (!ready) return undefined;
		const onError = () => { setReport(null); setError(copy.audioAnalysisFailed); };
		try {
			return selected ? observeSelectedSpectrum({
				analyze: () => controller.actions.analysis.plotSpectrum('master'), publish: setReport, onError,
				schedule: analyze => { const timer = setTimeout(analyze, 120); return () => clearTimeout(timer); },
			}) : observeLivePlaybackSpectrum({
				acquire: () => controller.engine.acquirePlaybackSpectrum(), tracks,
				position: () => controller.engine.getPositionFrames(), publish: setReport, onError,
				schedule: sample => { const timer = setInterval(sample, 100); return () => clearInterval(timer); },
			});
		} catch { onError(); return undefined; }
	}, [controller, copy.audioAnalysisFailed, ready, selected, tracks]);
	const display = report ?? { bins: [], peak: null, size: selected ? snapshot?.preferences?.spectrogram?.windowSize ?? 2048 : 4096,
		sampleRate: project?.sampleRate ?? 48_000 };
	return <div data-spectrum-mode={selected ? 'selection' : 'live'}>
		{!selected && <p className="audio-editor-panel-hint">{copy.spectrumLiveInstructions}</p>}
		<SpectrumResult report={display} copy={copy}>
			<SpectrumCanvas report={display} live={!selected} label={copy.spectrum} />
		</SpectrumResult>
		{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
	</div>;
}

function SpectrumCanvas({ report, live, label }: { readonly report: SpectrumPlotReport; readonly live: boolean; readonly label: string }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			const canvas = ref.current;
			const context = canvas?.getContext('2d');
			if (!context || !canvas) return;
			context.fillStyle = '#11141a'; context.fillRect(0, 0, canvas.width, canvas.height);
			const style = getComputedStyle(canvas);
			for (const curve of [...(report.tracks ?? []), report]) {
				context.strokeStyle = curve.color ? style.getPropertyValue(`--clip-${resolveAudioEditorColor(curve.color)}-header`).trim() || '#66d3c5' : '#66d3c5';
				context.lineWidth = 1.5; context.beginPath();
				spectrumPlotPoints(curve.bins).split(' ').forEach((point, index) => {
					const [x, y] = point.split(',').map(Number);
					if (index) context.lineTo(x! / 635 * canvas.width, y! / 150 * canvas.height);
					else context.moveTo(x! / 635 * canvas.width, y! / 150 * canvas.height);
				});
				context.stroke();
			}
		});
		return () => cancelAnimationFrame(frame);
	}, [report]);
	return <canvas ref={ref} width={320} height={112} role="img" aria-label={label}
		data-live-analysis-spectrum={live ? '' : undefined} data-analysis-spectrum />;
}
