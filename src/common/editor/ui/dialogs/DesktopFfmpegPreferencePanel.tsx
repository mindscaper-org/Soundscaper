/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import { DESKTOP_FFMPEG_COPY } from '../../../i18n/editor-desktop-ffmpeg-copy.ts';
import './DesktopFfmpegPreferencePanel.css';
import EditorControlLabel from '../EditorControlLabel.tsx';

type DesktopFfmpegPreferenceCopy = Readonly<{ [Key in keyof typeof DESKTOP_FFMPEG_COPY]: string }>;

export type DesktopFfmpegState =
	| 'unconfigured'
	| 'probing'
	| 'ready'
	| 'unsupported'
	| 'quarantined'
	| 'unavailable'
	| 'installing'
	| 'error';

export interface DesktopFfmpegStatus {
	readonly state: DesktopFfmpegState;
	readonly location: string | null;
	readonly version: string | null;
	readonly detail: string;
	readonly canInstall: boolean;
	readonly canBrowse: boolean;
	readonly canClear: boolean;
}

export interface DesktopFfmpegPreferenceFileService {
	readonly getExternalFfmpegStatus?: () => Promise<unknown> | null;
	readonly chooseExternalFfmpeg?: () => Promise<unknown> | null;
	readonly clearExternalFfmpeg?: () => Promise<unknown> | null;
	readonly rescanExternalFfmpeg?: () => Promise<unknown> | null;
	readonly installExternalFfmpeg?: () => Promise<unknown> | null;
}


export interface DesktopFfmpegPreferencePanelProps {
	readonly fileService: DesktopFfmpegPreferenceFileService;
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly initialStatus?: unknown;
}

const STATES = new Set<DesktopFfmpegState>([
	'unconfigured', 'probing', 'ready', 'unsupported', 'quarantined', 'unavailable',
	'installing', 'error',
]);

const PROBING_STATUS: DesktopFfmpegStatus = Object.freeze({
	state: 'probing', location: null, version: null, detail: '',
	canInstall: false, canBrowse: false, canClear: false,
});

export default function DesktopFfmpegPreferencePanel({
	fileService,
	copy: hostCopy,
	initialStatus = PROBING_STATUS,
}: DesktopFfmpegPreferencePanelProps) {
	const copy = useMemo(
		() => resolveEditorCopyScope('desktopFfmpeg', DESKTOP_FFMPEG_COPY, hostCopy),
		[hostCopy],
	);
	const [status, setStatus] = useState(() => normalizeDesktopFfmpegStatus(initialStatus));
	const locationId = useId();
	const getterAvailable = typeof fileService.getExternalFfmpegStatus === 'function';
	const requestRevision = useRef(0);
	const perform = useCallback(async (
		method: keyof DesktopFfmpegPreferenceFileService,
		pendingState: 'probing' | 'installing',
	): Promise<void> => {
		const operation = fileService[method];
		if (typeof operation !== 'function') return;
		const revision = ++requestRevision.current;
		setStatus((prior) => ({ ...prior, state: pendingState, detail: '' }));
		try {
			let next = normalizeDesktopFfmpegStatus(await operation.call(fileService));
			while (revision === requestRevision.current) {
				setStatus(next);
				if (!isBusy(next) || !fileService.getExternalFfmpegStatus) return;
				await new Promise<void>((resolve) => { globalThis.setTimeout(resolve, 250); });
				if (revision !== requestRevision.current) return;
				next = normalizeDesktopFfmpegStatus(await fileService.getExternalFfmpegStatus());
			}
		} catch (error) {
			if (revision === requestRevision.current) setStatus((prior) => errorStatus(error, prior));
		}
	}, [fileService]);

	useEffect(() => {
		if (getterAvailable) void perform('getExternalFfmpegStatus', 'probing');
		else setStatus(unavailableStatus());
		return () => { requestRevision.current += 1; };
	}, [getterAvailable, perform]);

	const busy = isBusy(status);
	const location = status.location ?? copy.externalFfmpegNoLocation;
	const summary = getterAvailable
		? statusSummary(copy, status)
		: copy.externalFfmpegControlsUnavailable;
	const detail = getterAvailable && status.state !== 'ready' ? status.detail : '';

	return (
		<PreferencePanel title={copy.externalFfmpeg}>
			<div
				className="kw-audio-editor-external-ffmpeg"
				data-external-ffmpeg-preference="true"
				data-external-ffmpeg-state={status.state}
			>
				<p>{copy.externalFfmpegDescription}</p>
				<div className="kw-audio-editor-external-ffmpeg__location">
					<label htmlFor={locationId}><EditorControlLabel>{copy.externalFfmpegLocation}</EditorControlLabel></label>
					<div className="kw-audio-editor-external-ffmpeg__path">
						<input id={locationId} value={location} readOnly />
						<Button variant="secondary" disabled={busy || !status.canBrowse || typeof fileService.chooseExternalFfmpeg !== 'function'} onClick={() => { void perform('chooseExternalFfmpeg', 'probing'); }}>{copy.externalFfmpegBrowse}</Button>
					</div>
				</div>
				{status.version && <p><span>{copy.externalFfmpegVersion}: </span><strong>{status.version}</strong></p>}
				{summary && <p
					role={status.state === 'error' || status.state === 'quarantined' ? 'alert' : 'status'}
					aria-live="polite"
					aria-busy={busy ? 'true' : undefined}
				>{summary}</p>}
				{detail && <small>{detail}</small>}
				<div className="kw-audio-editor-external-ffmpeg__actions">
					<Button variant="secondary" disabled={busy || typeof fileService.rescanExternalFfmpeg !== 'function'} onClick={() => { void perform('rescanExternalFfmpeg', 'probing'); }}>{copy.externalFfmpegRescan}</Button>
					{status.state !== 'ready' && <Button variant="secondary" disabled={busy || !status.canInstall || typeof fileService.installExternalFfmpeg !== 'function'} onClick={() => { void perform('installExternalFfmpeg', 'installing'); }}>{copy.externalFfmpegInstall}</Button>}
				</div>
			</div>
		</PreferencePanel>
	);
}

function isBusy(status: DesktopFfmpegStatus): boolean {
	return status.state === 'probing' || status.state === 'installing';
}

export function normalizeDesktopFfmpegStatus(value: unknown): DesktopFfmpegStatus {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailableStatus();
	const candidate = value as Readonly<Record<string, unknown>>;
	if (typeof candidate.state !== 'string' || !STATES.has(candidate.state as DesktopFfmpegState)) {
		return unavailableStatus();
	}
	const state = candidate.state as DesktopFfmpegState;
	return Object.freeze({
		state,
		location: nullableText(candidate.location, 4_096),
		version: nullableText(candidate.version, 256),
		detail: text(candidate.detail, 2_048),
		canInstall: candidate.canInstall === true,
		canBrowse: candidate.canBrowse === true,
		canClear: candidate.canClear === true,
	});
}

function unavailableStatus(): DesktopFfmpegStatus {
	return Object.freeze({
		state: 'unavailable', location: null, version: null, detail: '',
		canInstall: false, canBrowse: false, canClear: false,
	});
}

function errorStatus(error: unknown, prior: DesktopFfmpegStatus): DesktopFfmpegStatus {
	return Object.freeze({
		...prior,
		state: 'error',
		detail: error instanceof Error ? text(error.message, 2_048) : '',
	});
}

function nullableText(value: unknown, maximumLength: number): string | null {
	const normalized = text(value, maximumLength);
	return normalized === '' ? null : normalized;
}

function text(value: unknown, maximumLength: number): string {
	return typeof value === 'string' ? value.slice(0, maximumLength) : '';
}

function statusSummary(copy: DesktopFfmpegPreferenceCopy, status: DesktopFfmpegStatus): string {
	switch (status.state) {
		case 'unconfigured': return copy.externalFfmpegUnconfigured;
		case 'probing': return copy.externalFfmpegProbing;
		case 'ready': return '';
		case 'unsupported': return copy.externalFfmpegUnsupported;
		case 'quarantined': return copy.externalFfmpegQuarantined;
		case 'unavailable': return copy.externalFfmpegUnavailable;
		case 'installing': return copy.externalFfmpegInstalling;
		case 'error': return copy.externalFfmpegError;
	}
}
