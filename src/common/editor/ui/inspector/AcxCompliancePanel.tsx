/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { createAcxComplianceReport, type AcxComplianceCheck } from '../../acx-compliance.ts';
import { resolveSelectionRange } from '../../selection-range.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import { macroFileName, type InspectorFileService } from './inspector-helpers.ts';
import type { ACX_COMPLIANCE_COPY } from '../../../i18n/editor-acx-compliance-copy.ts';
import './acx-compliance-panel.css';

type Copy = Readonly<Record<keyof typeof ACX_COMPLIANCE_COPY, string>>;
interface Props {
	readonly controller: { readonly actions: { readonly analysis: { run(scope: string): Promise<unknown> } } };
	readonly snapshot?: {
		readonly ready?: boolean;
		readonly project?: { readonly id: string; readonly revision?: number; readonly title?: string; readonly clips?: readonly unknown[] } | null;
		readonly selectedClipId?: string | null;
		readonly importing?: boolean;
		readonly recording?: boolean;
		readonly exporting?: boolean;
		readonly analysisProcessing?: boolean;
		readonly missingSourceIds?: readonly string[];
	};
	readonly copy: Copy;
	readonly commonCopy: Readonly<Record<string, string>>;
	readonly fileService?: InspectorFileService;
}

/** A completed check belongs to the exact project and range that the user requested. */
export default function AcxCompliancePanel(props: Props) {
	const snapshot = props.snapshot;
	const range = resolveSelectionRange(snapshot?.project, { selectedClipId: snapshot?.selectedClipId });
	const key = JSON.stringify([editorProjectEditSessionKey(props.controller, snapshot?.project?.id),
		snapshot?.project?.revision, range?.startFrame, range?.endFrame]);
	return <AcxComplianceContent key={key} {...props} range={range} />;
}

function AcxComplianceContent({ controller, snapshot, copy, commonCopy, fileService, range }: Props & {
	readonly range: ReturnType<typeof resolveSelectionRange>;
}) {
	const [payload, setPayload] = useState<{ measurement: unknown; report: ReturnType<typeof createAcxComplianceReport> } | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');
	const operationRef = useRef<symbol | null>(null);
	useEffect(() => () => { operationRef.current = null; }, []);
	const blocked = !snapshot?.ready || !snapshot.project?.clips?.length || snapshot.importing || snapshot.recording
		|| snapshot.exporting || snapshot.analysisProcessing || Boolean(snapshot.missingSourceIds?.length);
	const perform = (operation: () => unknown, accept: (value: unknown) => void) => {
		const request = Symbol('acx-compliance');
		operationRef.current = request;
		setPending(true);
		setError('');
		void Promise.resolve().then(() => operationRef.current === request ? operation() : null).then(value => {
			if (operationRef.current === request) accept(value);
		}).catch((cause: unknown) => {
			if (operationRef.current === request) setError(cause instanceof Error ? cause.message : String(cause));
		}).finally(() => {
			if (operationRef.current === request) setPending(false);
		});
	};
	const checkAudio = () => {
		setPayload(null);
		perform(() => controller.actions.analysis.run('master'), measurement => {
			if (measurement == null) throw new Error(commonCopy.audioAnalysisFailed);
			setPayload({ measurement, report: createAcxComplianceReport(measurement) });
		});
	};
	const exportReport = () => {
		if (!payload || !fileService) return;
		const text = JSON.stringify({ schemaVersion: 1, project: snapshot?.project?.id,
			revision: snapshot?.project?.revision, scope: 'master', range,
			...payload }, null, 2);
		perform(() => fileService.saveFile({ purpose: 'report', mimeType: 'application/json', text,
			suggestedName: `${macroFileName(snapshot?.project?.title || 'soundscaper')}-acx-compliance.json` }), () => undefined);
	};
	return <div className="audio-editor-acx-compliance" data-acx-compliance aria-busy={pending}>
		<p className="audio-editor-panel-hint">{copy.scope}</p>
		{pending && !payload ? <p role="status">{copy.checking}</p> : payload ? <>
			<p role="status">{copy[`${payload.report.status}Summary`]}</p>
			<table aria-label={copy.table}>
				<thead><tr><th scope="col">{copy.requirement}</th><th scope="col">{copy.measured}</th><th scope="col">{copy.result}</th></tr></thead>
				<tbody>{payload.report.checks.map(check => <tr key={check.id}>
					<th scope="row">{copy[check.id]}<small>{copy[`${check.id}Limit`]}</small></th>
					<td>{formatMeasurement(check)}</td><td>{copy[check.status]}</td>
				</tr>)}</tbody>
			</table>
		</> : <p>{copy.empty}</p>}
		{error && <p role="alert" className="audio-editor-field-error">{error}</p>}
		<div className="audio-editor-panel-actions">
			<Button disabled={blocked || pending} onClick={checkAudio}>{copy.checkAudio}</Button>
			{fileService && <Button variant="secondary" disabled={!payload || pending} onClick={exportReport}>{commonCopy.export}</Button>}
		</div>
		<p className="audio-editor-panel-hint">{copy.remaining}</p>
		<a href="https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements" target="_blank" rel="noreferrer">{copy.source}</a>
	</div>;
}

function formatMeasurement({ id, value }: AcxComplianceCheck): string {
	if (value === null) return '—';
	if (id === 'sampleRate') return `${value.toLocaleString()} Hz`;
	if (id === 'channels') return String(value);
	if (id === 'duration') return `${value.toFixed(2)} s`;
	return `${value.toFixed(2)} dBFS`;
}
