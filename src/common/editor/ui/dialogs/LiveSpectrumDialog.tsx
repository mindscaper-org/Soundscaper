/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { observeLivePlaybackSpectrum, type LivePlaybackSpectrumReport } from '../../controller/analysis/live-spectrum-session.ts';
import type { EnginePublicApi } from '../../engine/public-api.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { macroFileName } from '../inspector/inspector-helpers.ts';
import SpectrumResult from './SpectrumResult.tsx';

interface Props {
	readonly controller: { readonly engine: Pick<EnginePublicApi, 'acquirePlaybackSpectrum' | 'getPositionFrames'> };
	readonly snapshot: { readonly project: {
		readonly id: string;
		readonly title?: string;
		readonly sampleRate: number;
		readonly tracks: readonly { readonly id: string; readonly type: string; readonly name?: string; readonly color?: string; readonly clipIds?: readonly string[] }[];
	} };
	readonly copy: Readonly<Record<string, string>>;
	readonly fileService: { saveFile(options: { purpose: 'report'; suggestedName: string; mimeType: string; text: string }): unknown };
	readonly onClose: () => void;
}

export default function LiveSpectrumDialog({ controller, snapshot, copy, fileService, onClose }: Props) {
	const project = snapshot.project;
	const tracks = useMemo(() => project.tracks.filter(track => track.type === 'audio' && track.clipIds?.length)
		.map(track => ({ id: track.id, name: track.name ?? track.id, color: track.color ?? 'blue' })), [project.tracks]);
	const [report, setReport] = useState<LivePlaybackSpectrumReport | null>(null);
	const [error, setError] = useState('');
	const saveRef = useRef<symbol | null>(null);
	useEffect(() => {
		setReport(null); setError('');
		const onError = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
		try {
			return observeLivePlaybackSpectrum({
				acquire: () => controller.engine.acquirePlaybackSpectrum(), tracks,
				position: () => controller.engine.getPositionFrames(), publish: setReport,
				schedule: sample => { const timer = setInterval(sample, 100); return () => clearInterval(timer); }, onError,
			});
		} catch (cause) { onError(cause); return undefined; }
	}, [controller, project.id, tracks]);
	useEffect(() => () => { saveRef.current = null; }, []);
	const exportReport = () => {
		if (!report) return;
		const submission = Symbol('live-spectrum-save'); saveRef.current = submission;
		const text = JSON.stringify({ schemaVersion: 1,
			project: { id: project.id, title: project.title, sampleRate: project.sampleRate }, mode: 'spectrum', result: null, report }, null, 2);
		void Promise.resolve().then(() => fileService.saveFile({ purpose: 'report',
			suggestedName: `${macroFileName(project.title || 'soundscaper')}-analysis.json`, mimeType: 'application/json', text }))
			.catch((cause: unknown) => { if (saveRef.current === submission) setError(cause instanceof Error ? cause.message : String(cause)); });
	};
	const empty = { bins: [], peak: null, size: 4096, sampleRate: project.sampleRate };
	return <AudioEditorDialogShell title={copy.plotSpectrum} onClose={onClose} width={620} modal={false} draggable closeOnOutside={false}
		dataAttributes={{ 'data-analysis-mode': 'spectrum', 'data-analysis-live': 'true' }}
		overlayDataAttributes={{ 'data-analysis-overlay': 'live-spectrum' }}>
		<div className="audio-editor-analysis-dialog">
			<p className="audio-editor-panel-hint">{copy.spectrumLiveInstructions}</p>
			<SpectrumResult report={report ?? empty} copy={copy} />
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
			<div className="audio-editor-panel-actions"><Button variant="secondary" disabled={!report} onClick={exportReport}>{copy.export}</Button></div>
		</div>
	</AudioEditorDialogShell>;
}
