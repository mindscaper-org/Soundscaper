/* SPDX-License-Identifier: AGPL-3.0-only */

import { formatLocalizedTemplate } from '../localization-template.ts';
import { Button } from '@soundscaper/design-system/Button';
import type { AudiocomArchiveSnapshot } from '../../controller/import/audiocom-project-archives.ts';

export interface AudiocomProjectArchivesProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly state: AudiocomArchiveSnapshot;
	readonly disabled?: boolean;
	readonly onRefresh: (page: number) => void;
	readonly onCancel: () => void;
}
export default function AudiocomProjectArchives({ copy, state, disabled = false, onRefresh, onCancel }: AudiocomProjectArchivesProps) {
	const busy = ['loading', 'uploading'].includes(state.status);
	return <details className="kw-audio-editor__audiocom-uploads" data-audiocom-projects="true">
		<summary>{copy.projectArchives}</summary>
		<div className="kw-audio-editor__audiocom-upload-content" aria-busy={busy}>
			<p>{copy.projectArchiveNotice}</p>
			<small>{copy.projectArchiveLimit.replaceAll('{size}', String(Math.floor(state.maximumBytes / 1000000)))}</small>
			<div className="kw-audio-editor__audiocom-upload-actions">
				<Button size="small" disabled={disabled || busy} onClick={() => onRefresh(1)}>{copy.refreshProjects}</Button>
				{busy ? <Button size="small" onClick={onCancel}>{copy.cancel}</Button> : null}
			</div>
			<div aria-live="polite">
				{busy ? <p role="status">{state.status === 'uploading' ? copy.projectUploading : copy.projectsLoading}</p> : null}
				{state.completedFileName ? <p role="status">{formatLocalizedTemplate(copy.projectUploaded, { name: state.completedFileName })}</p> : null}
			</div>
			{state.status === 'ready' && !state.results.length ? <p>{copy.noProjects}</p> : null}
			{state.results.length ? <ul className="kw-audio-editor__audiocom-upload-list" aria-label={copy.projectArchives}>
				{state.results.map(project => <li key={project.id} className="kw-audio-editor__audiocom-upload-item" data-audiocom-project-id={project.id}>
					<strong>{project.name}</strong><span>{copy.projectArchiveSize.replaceAll('{format}', project.format.toUpperCase()).replaceAll('{size}', (project.size / 1000000).toFixed(1))}</span>
				</li>)}
			</ul> : null}
			{state.page > 1 || state.hasNext ? <nav className="kw-audio-editor__audiocom-pagination" aria-label={copy.projectPages}>
				<Button size="small" disabled={busy || state.page <= 1} onClick={() => onRefresh(state.page - 1)}>{copy.previousPage}</Button>
				<span>{copy.pageNumber.replaceAll('{page}', String(state.page))}</span>
				<Button size="small" disabled={busy || !state.hasNext} onClick={() => onRefresh(state.page + 1)}>{copy.nextPage}</Button>
			</nav> : null}
		</div>
	</details>;
}
