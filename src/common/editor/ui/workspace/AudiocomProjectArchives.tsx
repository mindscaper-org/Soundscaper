/* SPDX-License-Identifier: AGPL-3.0-only */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@soundscaper/design-system/Button';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import type { AudiocomArchiveSnapshot, AudiocomProjectArchive } from '../../controller/import/audiocom-project-archives.ts';
import { useMenuTriggerDismissal } from '../use-menu-trigger-dismissal.ts';

export interface AudiocomProjectArchivesProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly state: AudiocomArchiveSnapshot;
	readonly disabled?: boolean;
	readonly onRefresh: (page: number) => void;
	readonly onUpload: (file: File, revision?: AudiocomProjectArchive) => void;
	readonly onDownload: (project: AudiocomProjectArchive) => void;
	readonly onCancel: () => void;
}
export default function AudiocomProjectArchives({ copy, state, disabled = false, onRefresh, onUpload, onDownload, onCancel }: AudiocomProjectArchivesProps) {
	const input = useRef<HTMLInputElement | null>(null);
	const button = useRef<HTMLButtonElement | null>(null);
	const revision = useRef<AudiocomProjectArchive | undefined>(undefined);
	const [menu, setMenu] = useState<{ x: number; y: number; host: Element; keyboard: boolean } | null>(null);
	const consumeDismissal = useMenuTriggerDismissal(button, Boolean(menu));
	const busy = ['loading', 'uploading', 'downloading'].includes(state.status);
	const chooseFile = (project?: AudiocomProjectArchive): void => { revision.current = project; setMenu(null); input.current?.click(); };
	return <details className="kw-audio-editor__audiocom-uploads" data-audiocom-projects="true">
		<summary>{copy.projectArchives}</summary>
		<div className="kw-audio-editor__audiocom-upload-content" aria-busy={busy}>
			<p>{copy.projectArchiveNotice}</p>
			<small>{copy.projectArchiveLimit.replaceAll('{size}', String(Math.floor(state.maximumBytes / 1000000)))}</small>
			<div className="kw-audio-editor__audiocom-upload-actions">
				<input ref={input} hidden type="file" accept={state.formats.map(format => `.${format}`).join(',')}
					aria-label={copy.chooseProjectArchive} disabled={disabled || busy} onChange={event => {
						const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
						if (file) onUpload(file, revision.current); revision.current = undefined;
					}} />
				<Button ref={button} size="small" disabled={disabled || busy} aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={event => {
					if (consumeDismissal()) return;
					if (menu) { setMenu(null); return; }
					const trigger = button.current; if (!trigger) return;
					const bounds = trigger.getBoundingClientRect();
					setMenu({ x: bounds.left, y: bounds.bottom, keyboard: event?.detail === 0,
						host: trigger.closest('[data-audio-editor]') ?? trigger.ownerDocument.body });
				}}>{copy.chooseProjectArchive}</Button>
				<Button size="small" disabled={busy} onClick={() => onRefresh(1)}>{copy.refreshProjects}</Button>
				{busy ? <Button size="small" onClick={onCancel}>{copy.cancel}</Button> : null}
			</div>
			<div aria-live="polite">
				{busy ? <p role="status">{state.status === 'uploading' ? copy.projectUploading : state.status === 'downloading' ? copy.projectDownloading : copy.projectsLoading}</p> : null}
				{state.completedFileName ? <p role="status">{copy.projectUploaded.replaceAll('{name}', state.completedFileName)}</p> : null}
				{state.errorMessage ? <p role="alert">{state.errorMessage}</p> : null}
			</div>
			{state.status === 'ready' && !state.results.length ? <p>{copy.noProjects}</p> : null}
			{state.results.length ? <ul className="kw-audio-editor__audiocom-upload-list" aria-label={copy.projectArchives}>
				{state.results.map(project => <li key={project.id} className="kw-audio-editor__audiocom-upload-item" data-audiocom-project-id={project.id}>
					<strong>{project.name}</strong><span>{copy.projectArchiveSize.replaceAll('{format}', project.format.toUpperCase()).replaceAll('{size}', (project.size / 1000000).toFixed(1))}</span>
					<Button size="small" disabled={busy || !project.snapshotId} onClick={() => onDownload(project)}>
						{copy.downloadProject}<span className="kw-audio-editor-sr-only">: {project.name}</span>
					</Button>
				</li>)}
			</ul> : null}
			{state.page > 1 || state.hasNext ? <nav className="kw-audio-editor__audiocom-pagination" aria-label={copy.projectPages}>
				<Button size="small" disabled={busy || state.page <= 1} onClick={() => onRefresh(state.page - 1)}>{copy.previousPage}</Button>
				<span>{copy.pageNumber.replaceAll('{page}', String(state.page))}</span>
				<Button size="small" disabled={busy || !state.hasNext} onClick={() => onRefresh(state.page + 1)}>{copy.nextPage}</Button>
			</nav> : null}
		</div>
		{menu && createPortal(<ContextMenu isOpen x={menu.x} y={menu.y} autoFocus={menu.keyboard}
			onClose={() => setMenu(null)} ariaLabel={copy.chooseProjectArchive}>
			<ContextMenuItem label={copy.uploadNewProject} onClick={() => chooseFile()} onClose={() => setMenu(null)} />
			{state.results.map(project => <ContextMenuItem key={project.id} disabled={!project.snapshotId || busy}
				label={copy.saveProjectRevision.replaceAll('{name}', project.name)} onClick={() => chooseFile(project)} onClose={() => setMenu(null)} />)}
		</ContextMenu>, menu.host)}
	</details>;
}
