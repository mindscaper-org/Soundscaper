/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import {
	fetchNyquistArchiveManifest,
	installNyquistArchivePlugin,
} from '../../nyquist/archive-catalog.js';
import { nyquistArchiveStore } from '../../nyquist/archive-store.js';
import { resolveNyquistArchiveCopy } from '../../../i18n/editor-nyquist-archive-copy.ts';
import { nyquistArchiveErrorLabel } from './nyquist-archive-error-copy.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { useOperationFocusRecovery } from '../useOperationFocusRecovery.ts';

export default function NyquistGetEffectsDialog({ copy, onClose }) {
	const archiveCopy = resolveNyquistArchiveCopy(copy);
	const [manifest, setManifest] = useState(null);
	const [query, setQuery] = useState('');
	const [installed, setInstalled] = useState(() => nyquistArchiveStore.list());
	const [busy, setBusy] = useState(null);
	const [error, setError] = useState(null);
	const captureFocus = useOperationFocusRecovery(busy !== null, nyquistArchiveStore);
	const requestRef = useRef(null);

	useEffect(() => {
		const request = new AbortController();
		requestRef.current = request;
		const refreshInstalled = () => setInstalled(nyquistArchiveStore.list());
		globalThis.addEventListener?.('soundscaper-nyquist-archive-changed', refreshInstalled);
		void fetchNyquistArchiveManifest({ signal: request.signal }).then((catalog) => {
			try { nyquistArchiveStore.updateCatalogMetadata(catalog.artifacts); } catch {
				// Optional display metadata must not prevent removing installed effects to free storage.
			}
			setInstalled(nyquistArchiveStore.list());
			setManifest(catalog);
		}).catch((reason) => {
			if (!request.signal.aborted) setError({ reason, operation: 'download' });
		});
		return () => {
			requestRef.current?.abort();
			globalThis.removeEventListener?.('soundscaper-nyquist-archive-changed', refreshInstalled);
		};
	}, []);

	const filtered = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		const artifacts = manifest?.artifacts ?? (error ? installed.map(plugin => ({
			fileName: plugin.fileName, title: plugin.name, description: plugin.description,
		})) : []);
		return artifacts.filter((artifact) => (
			[artifact.title, artifact.description, artifact.fileName].some((value) => value.toLocaleLowerCase().includes(needle))
		)).sort((left, right) => left.title.localeCompare(right.title)) ?? [];
	}, [manifest, query, error, installed]);
	const installedIds = useMemo(() => new Set(installed.map((plugin) => plugin.id)), [installed]);
	const close = () => {
		requestRef.current?.abort();
		onClose();
	};
	const install = async (artifact) => {
		captureFocus();
		const request = new AbortController();
		requestRef.current = request;
		setBusy(artifact.fileName);
		setError(null);
		try {
			await installNyquistArchivePlugin(nyquistArchiveStore, artifact, { signal: request.signal });
			if (!request.signal.aborted) setInstalled(nyquistArchiveStore.list());
		} catch (reason) {
			if (!request.signal.aborted) setError({ reason, operation: 'install' });
		} finally {
			if (!request.signal.aborted) setBusy(null);
		}
	};
	const remove = (id) => {
		try {
			nyquistArchiveStore.remove(id);
			setInstalled(nyquistArchiveStore.list());
			if (manifest) setError(null);
		} catch (reason) {
			setError({ reason, operation: 'remove' });
		}
	};

	return <AudioEditorDialogShell
		title={archiveCopy.getEffects}
		onClose={close}
		width={740}
		dataAttributes={{ 'data-nyquist-get-effects': true }}
		footer={<DialogFooter rightContent={<Button variant="secondary" onClick={close}>{copy.close}</Button>} />}
	>
		<p>{archiveCopy.description}</p>
		<label className="kw-audio-editor-dialog__field">
			<span>{archiveCopy.searchEffects}</span>
			<input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
		</label>
		{error && <><p role="alert">{nyquistArchiveErrorLabel(error.reason, error.operation, archiveCopy)}</p>
			<details><summary>{copy.assistanceTechnicalDetails || 'Technical details'}</summary>
				<pre>{error.reason instanceof Error ? error.reason.message : String(error.reason)}</pre></details></>}
		{!manifest && !error && <p role="status">{copy.loading}</p>}
		{(manifest || error) && <>
			<p>{archiveCopy.effectCount.replace('{count}', String(filtered.length))}</p>
			<div style={{ maxHeight: 400, overflowY: 'auto' }}>
				<ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
					{filtered.map((artifact) => {
						const id = `nyquist:archive:${artifact.fileName}`;
						return <li key={artifact.fileName} style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'space-between', padding: '10px 0' }}>
							<div style={{ minWidth: 0, flex: 1 }}>
								<strong>{artifact.title}</strong>
								<p style={{ margin: '4px 0 0' }}>{artifact.description}</p>
							</div>
							{installedIds.has(id)
								? <Button variant="secondary" disabled={Boolean(busy)} onClick={() => remove(id)}>
									{archiveCopy.removeEffect}<span className="kw-audio-editor-sr-only"> {artifact.title}</span>
								</Button>
								: <Button variant="secondary" disabled={Boolean(busy)} onClick={() => { void install(artifact); }}>
									{busy === artifact.fileName ? copy.loading : archiveCopy.installEffect}<span className="kw-audio-editor-sr-only"> {artifact.title}</span>
								</Button>}
						</li>;
					})}
				</ul>
			</div>
		</>}
	</AudioEditorDialogShell>;
}
