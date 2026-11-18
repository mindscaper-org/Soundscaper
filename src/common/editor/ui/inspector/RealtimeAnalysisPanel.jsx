/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { useComponentCopy } from '@soundscaper/design-system/contexts/ComponentCopyContext';

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { EbuR128WorkspacePanel } from '../toolbar/AudioEditorMeters.jsx';
import { ChannelCorrelationJellyfish } from './ChannelCorrelationJellyfish.tsx';
import AcxCompliancePanel from './AcxCompliancePanel.tsx';
import { ACX_COMPLIANCE_COPY } from '../../../i18n/editor-acx-compliance-copy.ts';
import { useTranslationScope } from '../use-translation-scope.ts';
import EditorControlLabel from '../EditorControlLabel.tsx';
import AnalysisSpectrumPanel from './AnalysisSpectrumPanel.tsx';

const SPECTROGRAM_WIDTH = 320;
const SPECTROGRAM_HEIGHT = 96;

export default function RealtimeAnalysisPanel({ controller, copy, settings, active = true, projectId = '', snapshot = /** @type {import('./AnalysisSpectrumPanel.tsx').AnalysisSpectrumSnapshot} */ (undefined), fileService = undefined }) {
	const { locale } = useComponentCopy();
	const acxCopy = useTranslationScope('acxCompliance', ACX_COMPLIANCE_COPY, locale, copy);
	return <div className="audio-editor-realtime-analysis" data-realtime-analysis>
		<AnalysisSection id="levels" title={copy.metering} initiallyOpen active={active}>
			<LiveLevels controller={controller} copy={copy} />
		</AnalysisSection>
		<AnalysisSection id="loudness" title={copy.meterTypeEbuR128} active={active}>
			<EbuR128WorkspacePanel controller={controller} copy={copy} settings={settings} />
		</AnalysisSection>
		<AnalysisSection id="spectrum" title={copy.spectrum} active={active}>
			<AnalysisSpectrumPanel controller={controller} snapshot={snapshot} copy={copy} />
		</AnalysisSection>
		<AnalysisSection id="spectrogram" title={copy.spectrogram} active={active}>
			<VisualAnalysisLease controller={controller}>
				<LiveSpectrogram key={projectId} controller={controller} copy={copy} />
			</VisualAnalysisLease>
		</AnalysisSection>
		<AnalysisSection id="correlation" title={copy.correlation} active={active}>
			<VisualAnalysisLease controller={controller}>
				<ChannelCorrelationJellyfish controller={controller} copy={copy} />
			</VisualAnalysisLease>
		</AnalysisSection>
		<AnalysisSection id="acx" title={acxCopy.title} active={active}>
			<AcxCompliancePanel controller={controller} snapshot={snapshot} copy={acxCopy} commonCopy={copy} locale={locale} fileService={fileService} />
		</AnalysisSection>
	</div>;
}

function VisualAnalysisLease({ controller, children }) {
	useEffect(() => controller.engine?.acquireLiveAnalysis?.(), [controller]);
	return children;
}

function AnalysisSection({ id, title, initiallyOpen = false, active, children }) {
	const [open, setOpen] = useState(initiallyOpen);
	return <details data-analysis-section={id} open={open}
		onToggle={(event) => setOpen(event.currentTarget.open)}>
		<summary>{title}</summary>
		{open && active && <div className="audio-editor-realtime-analysis__content">{children}</div>}
	</details>;
}

function LiveLevels({ controller, copy }) {
	const meter = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master);
	const peak = Number(meter?.peak);
	const rms = Number(meter?.rms);
	return <div className="audio-editor-analysis-grid" data-live-analysis-levels>
		<LiveLevel label={copy.peak} value={levelDb(peak)} dataKey="peak" />
		<LiveLevel label={copy.rms} value={levelDb(rms)} dataKey="rms" />
		<LiveLevel label={copy.clipping} value={peak >= 1 ? '●' : '—'} dataKey="clipping" />
	</div>;
}

function LiveLevel({ label, value, dataKey }) {
	return <div><EditorControlLabel>{label}</EditorControlLabel><strong data-live-analysis-value={dataKey}>{value}</strong></div>;
}

function levelDb(amplitude) {
	return Number.isFinite(amplitude) && amplitude > 0
		? `${(20 * Math.log10(amplitude)).toFixed(1)} dBFS`
		: '−∞ dBFS';
}

function LiveSpectrogram({ controller, copy }) {
	const bins = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master?.spectrumDb);
	const canvasRef = useRef(null);
	useEffect(() => schedulePaint(canvasRef.current, (context) => paintSpectrogramColumn(context, bins)), [bins]);
	return <canvas ref={canvasRef} width={SPECTROGRAM_WIDTH} height={SPECTROGRAM_HEIGHT}
		data-live-analysis-spectrogram role="img" aria-label={copy.spectrogram} />;
}

function schedulePaint(canvas, paint) {
	if (!canvas || typeof canvas.getContext !== 'function') return undefined;
	const handle = requestAnimationFrame(() => {
		const context = canvas.getContext('2d');
		if (context) paint(context);
	});
	return () => cancelAnimationFrame(handle);
}

function paintSpectrogramColumn(context, bins) {
	context.drawImage(context.canvas, -1, 0);
	context.fillStyle = '#090b10';
	context.fillRect(SPECTROGRAM_WIDTH - 1, 0, 1, SPECTROGRAM_HEIGHT);
	const count = Math.min(128, bins?.length ?? 0);
	if (!count) return;
	for (let row = 0; row < SPECTROGRAM_HEIGHT; row += 1) {
		const band = SPECTROGRAM_HEIGHT - 1 - row;
		const start = Math.floor(band / SPECTROGRAM_HEIGHT * count);
		const end = Math.max(start + 1, Math.floor((band + 1) / SPECTROGRAM_HEIGHT * count));
		let brightness = 0;
		for (let index = start; index < end; index += 1) brightness = Math.max(brightness, intensity(bins[index]));
		context.fillStyle = `hsl(${Math.round(220 - brightness * 180)} 90% ${Math.round(7 + brightness * 60)}%)`;
		context.fillRect(SPECTROGRAM_WIDTH - 1, row, 1, 1);
	}
}

function intensity(value) {
	return Math.max(0, Math.min(1, (Number(value) + 90) / 90 || 0));
}
