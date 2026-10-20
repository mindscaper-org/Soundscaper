/* SPDX-License-Identifier: AGPL-3.0-only */
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { PhotoLibraryDebugSoakContextCurrentV1 } from './photo-library-debug-soak-context-current-v1.ts';
import { LightscaperPhotoBackendContextCurrentV1 } from './photo-library-backend-context-current-v1.ts';
import { photoLibraryDebugSoakCopyCurrentV1 } from '../../../i18n/lightscaper-debug-soak-copy-current-v1.ts';
import type { PhotoLibraryDebugSoakOwnerCurrentV1 } from '../../../../lightscaper/quality/photo-library-debug-soak-owner-current-v1.ts';
import type { LightscaperPhotoBackendSwitchCurrentV1 } from '../../controller/composition/lightscaper-photo-backend-switch-current-v1.ts';
export default function PhotoLibraryDebugSoakMenuCurrentV1({ locale }: Readonly<{ locale: string }>) {
	const owner = useContext(PhotoLibraryDebugSoakContextCurrentV1), backend = useContext(LightscaperPhotoBackendContextCurrentV1);
	return owner && backend ? <Menu owner={owner} backend={backend} locale={locale} /> : null;
}
function Menu({ owner, backend, locale }: Readonly<{ owner: PhotoLibraryDebugSoakOwnerCurrentV1; backend: LightscaperPhotoBackendSwitchCurrentV1; locale: string }>) {
	const state = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot), workspace = useSyncExternalStore(backend.subscribe, backend.snapshot, backend.snapshot);
	const [open, setOpen] = useState(false), [files, setFiles] = useState<readonly File[]>([]), [failure, setFailure] = useState(false), copy = photoLibraryDebugSoakCopyCurrentV1(locale);
	const target = workspace.target instanceof HTMLElement ? workspace.target : null;
	const mounts = useRef(new Map<PhotoLibraryDebugSoakOwnerCurrentV1, number>());
	useEffect(() => { const counts = mounts.current; counts.set(owner, (counts.get(owner) ?? 0) + 1);
		return () => { counts.set(owner, (counts.get(owner) ?? 1) - 1); queueMicrotask(() => { if (!counts.get(owner)) { counts.delete(owner); void owner.close().catch(() => undefined); } }); };
	}, [owner]);
	const menu = target ? createPortal(<button type="button" data-photo-debug-soak-menu disabled={!workspace.ready || workspace.busy || workspace.failed || workspace.safety !== 'ready'} onClick={() => { setFailure(false); setOpen(true); }}>{copy.title}</button>, target) : null;
	const start = (): void => { setFailure(false); void owner.start(files).catch(() => { setFailure(true); }); };
	return <>{menu}{open ? <AudioEditorDialogShell title={copy.title} width={680} closeOnEscape={!state.busy} onClose={() => { if (!state.busy) setOpen(false); }}>
		<p>{copy.help}</p><p>{copy.measurement}</p>
		<label>{copy.files}<input type="file" multiple accept="image/*,.dng,.nef,.cr2,.cr3,.arw,.raf,.orf,.rw2,.pef" disabled={state.busy} onChange={event => { setFiles(Array.from(event.currentTarget.files ?? [])); }} /></label>
		{state.phase ? <p role="status" aria-label={copy.progress}>{state.phase.iteration}/3: {state.phase.phase}</p> : null}
		{failure || state.failed ? <p role="alert">{copy.failed}</p> : null}
		{state.report ? <label>{copy.report}<textarea readOnly rows={12} data-photo-debug-soak-report data-status="complete" value={JSON.stringify(state.report, null, 2)} /></label> : null}
		<div><button type="button" disabled={state.busy || files.length === 0 || state.failedCleanup} onClick={start}>{copy.run}</button>
		<button type="button" disabled={!state.busy} onClick={() => owner.stop()}>{copy.stop}</button>
		<button type="button" disabled={state.busy} onClick={() => setOpen(false)}>{copy.close}</button></div>
	</AudioEditorDialogShell> : null}</>;
}
