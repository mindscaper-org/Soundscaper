/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useState } from 'react';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';

interface Status { readonly available: boolean; readonly enabled: boolean }
interface FileService { updatePreferences?(enabled?: boolean): unknown }
function isStatus(value: unknown): value is Status {
	return !!value && typeof value === 'object' && 'available' in value && typeof value.available === 'boolean'
		&& 'enabled' in value && typeof value.enabled === 'boolean';
}
export default function DesktopUpdatePreferencesPanel({ fileService, copy, run }: Readonly<{
	fileService: FileService;
	copy: Readonly<Record<string, unknown>>;
	run(operation: () => unknown): unknown;
}>) {
	const [status, setStatus] = useState<Status | null>(null);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		let current = true;
		run(async () => {
			const value = await fileService.updatePreferences?.();
			if (current && isStatus(value)) setStatus(value);
		});
		return () => { current = false; };
	}, [fileService, run]);
	return <PreferencePanel title={String(copy.updatesSection)}>
		<PreferenceCheckbox label={String(copy.checkUpdates)} checked={status?.enabled === true}
			disabled={!status?.available || saving} onChange={enabled => {
				run(async () => {
					setSaving(true);
					try {
						const value = await fileService.updatePreferences?.(enabled);
						if (isStatus(value)) setStatus(value);
					} finally { setSaving(false); }
				});
			}} />
	</PreferencePanel>;
}
