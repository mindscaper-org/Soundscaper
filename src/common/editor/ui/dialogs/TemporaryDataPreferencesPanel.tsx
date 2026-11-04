/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import { normalizeTemporaryDataPreferences, type TemporaryDataPreferences } from '../../saving-preferences.ts';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import PreferenceNumberInput from './PreferenceNumberInput.tsx';

interface FolderStatus { readonly folder: string; readonly selectedFolder: string; readonly restartRequired: boolean }
export interface TemporaryDataFileService {
	readonly isDesktop?: boolean;
	temporaryDataStatus?(): PromiseLike<unknown> | unknown;
	chooseTemporaryDataFolder?(): PromiseLike<unknown> | unknown;
}
export default function TemporaryDataPreferencesPanel(d: Readonly<{
	controller: { actions: { preferences: { update(patch: { temporaryData: Partial<TemporaryDataPreferences> }): unknown } } };
	preferences?: TemporaryDataPreferences;
	copy: Readonly<Record<string, unknown>>;
	fileService?: TemporaryDataFileService;
	run(operation: () => unknown): unknown;
}>) {
	const copy = d.copy as Readonly<Record<'temporaryDataSection' | 'temporaryProjectsLimit' | 'temporaryProjectsCount' | 'temporaryProjectsDescription' | 'temporaryDataFolder' | 'temporaryDataBrowserFolder' | 'temporaryDataBrowse' | 'temporaryDataBrowserFolderDescription' | 'temporaryDataRestart', string>>;
	const preferences = normalizeTemporaryDataPreferences(d.preferences);
	const { fileService, run } = d;
	const [folder, setFolder] = useState<FolderStatus | null>(null);
	useEffect(() => {
		let active = true;
		run(async () => {
			const result = await fileService?.temporaryDataStatus?.();
			if (active && isFolderStatus(result)) setFolder(result);
		});
		return () => { active = false; };
	}, [fileService, run]);
	const choose = () => d.run(async () => {
		const result = await d.fileService?.chooseTemporaryDataFolder?.();
		if (isFolderStatus(result)) setFolder(result);
	});
	return <PreferencePanel title={copy.temporaryDataSection}>
		<div className="kw-audio-editor-preferences__grid">
			<PreferenceCheckbox label={copy.temporaryProjectsLimit} checked={preferences.limitProjects}
				onChange={limitProjects => { d.run(() => d.controller.actions.preferences.update({ temporaryData: { limitProjects } })); }} />
			<PreferenceNumberInput label={copy.temporaryProjectsCount} value={preferences.maximumProjects} minimum={1} maximum={Number.MAX_SAFE_INTEGER}
				integer disabled={!preferences.limitProjects} onCommit={maximumProjects => d.run(() => d.controller.actions.preferences.update({ temporaryData: { maximumProjects } }))} />
		</div>
		<p className="kw-audio-editor-preferences__note">{copy.temporaryProjectsDescription}</p>
		<label className="kw-audio-editor-preferences__field">
			<span>{copy.temporaryDataFolder}</span>
			<input type="text" readOnly value={d.fileService?.isDesktop ? folder?.selectedFolder ?? '' : copy.temporaryDataBrowserFolder} />
		</label>
		{d.fileService?.isDesktop
			? <Button variant="secondary" disabled={!d.fileService.chooseTemporaryDataFolder} onClick={choose}>{copy.temporaryDataBrowse}</Button>
			: <p className="kw-audio-editor-preferences__note">{copy.temporaryDataBrowserFolderDescription}</p>}
		{folder?.restartRequired && <p role="status" className="kw-audio-editor-preferences__note">{copy.temporaryDataRestart}</p>}
	</PreferencePanel>;
}
function isFolderStatus(value: unknown): value is FolderStatus {
	return !!value && typeof value === 'object' && 'folder' in value && typeof value.folder === 'string'
		&& 'selectedFolder' in value && typeof value.selectedFolder === 'string' && 'restartRequired' in value && typeof value.restartRequired === 'boolean';
}
