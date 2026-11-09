/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import { createRawPcmSourceProvenance, prepareRawPcmWaveFile, type RawPcmByteOrder, type RawPcmSampleFormat } from '../../controller/import/raw-pcm-import.ts';
import { detectRawPcmFormat } from '../../controller/import/raw-pcm-detection.ts';
import type { SourceProvenanceV1 } from '../../source-provenance.ts';
import type { FileSizeWarningConfirmation } from '../../controller/shared/file-size-warning.ts';
import type { RegularIntervalAnnotationOptions } from '../../controller/document/regular-interval-annotation-service.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import EditorMusicalTimeCodeProvider from '../EditorMusicalTimeCodeProvider.tsx';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';
import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';
import { regularIntervalDialogDefaults, type RegularIntervalDialogProject } from '../regular-interval-dialog-defaults.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';

interface DialogController {
	readonly project: RegularIntervalDialogProject | null;
	readonly actions: Readonly<{
		readonly project: Readonly<{ importFiles(files: readonly File[], options?: Readonly<{ signal: AbortSignal; sourceProvenance?: SourceProvenanceV1 }>): unknown }>;
		readonly timelineAnnotations: Readonly<{ regularInterval(options: RegularIntervalAnnotationOptions): unknown }>;
	}>;
}

interface CommonProps {
	readonly controller: DialogController;
	readonly snapshot?: AudioEditorEditBlockingSnapshot;
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
	readonly confirmFileSizeWarning?: FileSizeWarningConfirmation;
	readonly fileService?: Readonly<{ isDesktop: boolean }>;
}

export function RawPcmImportDialog({ controller, snapshot, copy, run, onClose, fileService, confirmFileSizeWarning }: CommonProps) {
	const blocked = selectAudioEditorEditBlock(snapshot).blocked;
	const blockedRef = useRef(blocked);
	blockedRef.current = blocked;
	const [file, setFile] = useState<File | null>(null);
	const [sampleFormat, setSampleFormat] = useState<RawPcmSampleFormat>('int16');
	const [byteOrder, setByteOrder] = useState<RawPcmByteOrder>('little');
	const [sampleRate, setSampleRate] = useState('44100');
	const [channelCount, setChannelCount] = useState('1');
	const [offsetBytes, setOffsetBytes] = useState('0');
	const [busy, setBusy] = useState(false);
	const [detecting, setDetecting] = useState(false);
	const [detectionMessage, setDetectionMessage] = useState<string | null>(null);
	const busyRef = useRef(false);
	const pendingOperation = useRef<AbortController | null>(null);
	const projectIdentity = controller.project?.id ?? null;
	const projectSession = editorProjectEditSessionKey(controller, projectIdentity);
	const formId = 'audio-editor-raw-pcm-import-form';
	useEffect(() => {
		setBusy(false);
		setDetecting(false);
		setDetectionMessage(null);
		return () => {
			pendingOperation.current?.abort();
			pendingOperation.current = null;
			busyRef.current = false;
		};
	}, [projectSession]);
	const close = (): void => {
		pendingOperation.current?.abort();
		onClose();
	};
	const chooseFile = (next: File | null): void => {
		pendingOperation.current?.abort();
		pendingOperation.current = null;
		busyRef.current = false;
		setBusy(false);
		setDetecting(false);
		setDetectionMessage(null);
		setFile(next);
	};
	const detect = (): void => {
		if (!file || busyRef.current || blockedRef.current) return;
		const cancellation = new AbortController();
		pendingOperation.current = cancellation;
		busyRef.current = true;
		setBusy(true);
		setDetecting(true);
		setDetectionMessage(null);
		run(async () => {
			try {
				const result = await detectRawPcmFormat(file, { offsetBytes: Number(offsetBytes), signal: cancellation.signal });
				if (cancellation.signal.aborted
					|| editorProjectEditSessionKey(controller, controller.project?.id) !== projectSession) return;
				if (result) {
					setSampleFormat(result.sampleFormat);
					setByteOrder(result.byteOrder);
					setChannelCount(String(result.channelCount));
				}
				setDetectionMessage(result ? copy.rawPcmDetected : copy.rawPcmNotDetected);
			} catch (error) {
				if (!cancellation.signal.aborted) throw error;
			} finally {
				if (pendingOperation.current === cancellation) {
					pendingOperation.current = null;
					busyRef.current = false;
					setBusy(false);
					setDetecting(false);
				}
			}
		});
	};
	// The import button sits in the shared footer, outside the form, so the
	// import path is a named handler the footer click and the form's Enter
	// submit both enter through.
	const importRawPcm = (): void => {
		if (!file || busyRef.current || blockedRef.current) return;
		const cancellation = new AbortController();
		pendingOperation.current = cancellation;
		const projectIsCurrent = (): boolean => !cancellation.signal.aborted
			&& editorProjectEditSessionKey(controller, controller.project?.id) === projectSession;
		busyRef.current = true;
		setBusy(true);
		run(async () => {
			try {
				const wav = await withWebFileLoadLimitContext(() => prepareRawPcmWaveFile(file, { sampleFormat, byteOrder, sampleRate: Number(sampleRate), channelCount: Number(channelCount), offsetBytes: Number(offsetBytes) },
					{ desktop: fileService?.isDesktop === true, confirmFileSizeWarning, signal: cancellation.signal, assertCurrent: () => { if (!projectIsCurrent()) throw new DOMException('The project changed.', 'AbortError'); } }));
				if (!projectIsCurrent()) return;
				await controller.actions.project.importFiles([wav], {
					signal: cancellation.signal, sourceProvenance: createRawPcmSourceProvenance(file),
				});
				if (!projectIsCurrent()) return;
			} catch (error) {
				if (!cancellation.signal.aborted) throw error;
			} finally {
				if (pendingOperation.current === cancellation) {
					pendingOperation.current = null;
					busyRef.current = false;
					setBusy(false);
				}
			}
			if (projectIsCurrent()) onClose();
		});
	};
	return <AudioEditorDialogShell
		title={copy.audacityParityLabelImportRawData}
		onClose={close}
		width={560}
		dataAttributes={{ 'data-import-surface': 'raw-pcm' }}
		footer={<DialogFooter
			className="audio-editor-dialog-footer"
			leftContent={<Button variant="secondary" type="button" disabled={!file || busy || blocked}
				onClick={detect}>{copy.rawPcmDetect}</Button>}
			rightContent={<>
				<Button variant="secondary" onClick={close}>{copy.cancel}</Button>
				<Button
					className="audio-editor-raw-pcm-import-confirm"
					variant="primary"
					type="submit" form={formId}
					disabled={!file || busy || blocked}
				>{copy.importFile}</Button>
			</>}
		/>}
	>
		<form id={formId} className="kw-audio-editor-dialog__form" onSubmit={(event) => {
			event.preventDefault();
			importRawPcm();
		}} aria-busy={busy}>
			<label className="kw-audio-editor-dialog__field"><span>{copy.rawPcmFile}</span><input required disabled={busy} type="file" accept=".raw,.pcm,application/octet-stream" onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)} /></label>
			<label className="kw-audio-editor-dialog__field"><span>{copy.rawPcmSampleFormat}</span><select disabled={busy} value={sampleFormat} onChange={(event) => setSampleFormat(event.currentTarget.value as RawPcmSampleFormat)}>
				<option value="uint8">{copy.rawPcmUint8}</option><option value="int16">{copy.rawPcmInt16}</option><option value="int24">{copy.rawPcmInt24}</option><option value="int32">{copy.rawPcmInt32}</option><option value="float32">{copy.rawPcmFloat32}</option>
			</select></label>
			<label className="kw-audio-editor-dialog__field"><span>{copy.rawPcmByteOrder}</span><select disabled={busy || sampleFormat === 'uint8'} value={byteOrder} onChange={(event) => setByteOrder(event.currentTarget.value as RawPcmByteOrder)}>
				<option value="little">{copy.rawPcmLittleEndian}</option><option value="big">{copy.rawPcmBigEndian}</option>
			</select></label>
			<NumberField disabled={busy} label={copy.sampleRate} value={sampleRate} minimum={1} maximum={384_000} onChange={setSampleRate} />
			<NumberField disabled={busy} label={copy.rawPcmChannelCount} value={channelCount} minimum={1} maximum={32} onChange={setChannelCount} />
			<NumberField disabled={busy} label={copy.rawPcmByteOffset} value={offsetBytes} minimum={0} maximum={Number.MAX_SAFE_INTEGER} onChange={setOffsetBytes} />
			{(detecting || detectionMessage) && <p role="status">{detecting ? copy.rawPcmDetecting : detectionMessage}</p>}
		</form>
	</AudioEditorDialogShell>;
}

export function RegularIntervalAnnotationDialog({ controller, snapshot, copy, run, onClose }: CommonProps) {
	const blocked = selectAudioEditorEditBlock(snapshot).blocked;
	const blockedRef = useRef(blocked);
	blockedRef.current = blocked;
	const project = controller.project;
	const projectIdentity = project?.id ?? null;
	const intervalClock = useMemo(() => {
		const intervalSnapshot = { project };
		return { getSnapshot: () => intervalSnapshot, subscribe: () => () => undefined };
	}, [project]);
	const defaults = regularIntervalDialogDefaults(project);
	const stateProjectIdentity = useRef(projectIdentity);
	const [kind, setKind] = useState<'marker' | 'region'>(defaults.kind);
	const [startFrame, setStartFrame] = useState(defaults.startFrame);
	const [endFrame, setEndFrame] = useState(defaults.endFrame);
	const [intervalFrames, setIntervalFrames] = useState(defaults.intervalFrames);
	const [namePrefix, setNamePrefix] = useState(defaults.namePrefix);
	const formId = 'audio-editor-regular-interval-form';
	useEffect(() => {
		if (stateProjectIdentity.current === projectIdentity) return;
		stateProjectIdentity.current = projectIdentity;
		setKind(defaults.kind);
		setStartFrame(defaults.startFrame);
		setEndFrame(defaults.endFrame);
		setIntervalFrames(defaults.intervalFrames);
		setNamePrefix(defaults.namePrefix);
	}, [defaults.endFrame, defaults.intervalFrames, defaults.kind, defaults.namePrefix, defaults.startFrame, projectIdentity]);
	// The create button lives in the shared footer, outside the form, so both
	// it and the form's Enter submit enter through one named handler.
	const create = (): void => {
		if (blockedRef.current || !project
			|| stateProjectIdentity.current !== projectIdentity
			|| controller.project?.id !== project.id) return;
		const projectId = project.id;
		const request: RegularIntervalAnnotationOptions = {
			kind, anchor: 'sample', sequenceId: project.primarySequenceId, startFrame, endFrame,
			intervalFrames, namePrefix, color: 'auto',
		};
		void runAwaitedAudioEditorOperation(run, () => {
			if (blockedRef.current || controller.project?.id !== projectId) return undefined;
			return controller.actions.timelineAnnotations.regularInterval(request);
		}).then(() => {
			if (controller.project?.id === projectId) onClose();
		}).catch(() => undefined);
	};
	return <AudioEditorDialogShell title={copy.regularIntervalLabels} onClose={onClose} width={560}
		dataAttributes={{ 'data-annotation-surface': 'regular-interval' }}
		footer={<DialogFooter
			className="audio-editor-dialog-footer"
			rightContent={<>
				<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
				<Button variant="primary" type="submit" form={formId} disabled={!project || blocked}>{copy.regularIntervalCreate}</Button>
			</>}
		/>}
	>
		<form id={formId} className="kw-audio-editor-dialog__form" onSubmit={(event) => {
			event.preventDefault();
			create();
		}}>
			<label className="kw-audio-editor-dialog__field"><span>{copy.regularIntervalKind}</span><select value={kind} onChange={(event) => setKind(event.currentTarget.value as 'marker' | 'region')}><option value="marker">{copy.regularIntervalMarker}</option><option value="region">{copy.regularIntervalRegion}</option></select></label>
			<TimeField name="startFrame" label={copy.regularIntervalStartFrame} value={startFrame} sampleRate={project?.sampleRate}
				minimum={0} maximum={Math.max(0, endFrame - 1)} onChange={setStartFrame} />
			<TimeField name="endFrame" label={copy.regularIntervalEndFrame} value={endFrame} sampleRate={project?.sampleRate}
				minimum={startFrame + 1} maximum={Number.MAX_SAFE_INTEGER} onChange={setEndFrame} />
			<EditorMusicalTimeCodeProvider controller={intervalClock} originFrame={startFrame}>
				<TimeField name="intervalFrames" label={copy.regularIntervalFrames} value={intervalFrames} sampleRate={project?.sampleRate}
					minimum={1} maximum={Number.MAX_SAFE_INTEGER} onChange={setIntervalFrames} />
			</EditorMusicalTimeCodeProvider>
			<label className="kw-audio-editor-dialog__field"><span>{copy.regularIntervalNamePrefix}</span><input value={namePrefix} onChange={(event) => setNamePrefix(event.currentTarget.value)} /></label>
		</form>
	</AudioEditorDialogShell>;
}

function NumberField({ label, value, minimum, maximum, onChange, disabled }: Readonly<{
	label: string; value: string; minimum: number; maximum: number; onChange(value: string): void; disabled?: boolean;
}>) {
	return <label className="kw-audio-editor-dialog__field"><span>{label}</span><input required disabled={disabled} type="number" min={minimum} max={maximum} step={1} value={value} onChange={(event) => onChange(event.currentTarget.value)} /></label>;
}

function TimeField({ name, label, value, sampleRate = 48_000, minimum, maximum, onChange }: Readonly<{
	name: string; label: string; value: number; sampleRate?: number; minimum: number; maximum: number;
	onChange(value: number): void;
}>) {
	return <label className="kw-audio-editor-dialog__field"><span>{label}</span>
		<AudioEditorTimeCodeInput name={name} label={label} value={value} unit="samples" rate={sampleRate}
			format="hh:mm:ss+milliseconds" minimum={minimum} maximum={maximum}
			onChange={onChange} />
	</label>;
}
