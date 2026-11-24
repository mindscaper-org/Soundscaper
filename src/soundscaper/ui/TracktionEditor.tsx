/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import { TRACK_COPY_BY_LOCALE } from '../../common/i18n/track-copy.js';
import type { TracktionDesktopBridge } from '../tracktion-project-contract.ts';
import { readTracktionWorkspace, type TracktionWorkspace } from '../tracktion-workspace.ts';

const copy = PROJECT_COMMAND_COPY_BY_LOCALE.en;

export function TracktionEditor({ bridge }: { readonly bridge: TracktionDesktopBridge }) {
	const [workspace, setWorkspace] = useState<TracktionWorkspace | null>(null);
	const [savedRevision, setSavedRevision] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState('');
	const [failure, setFailure] = useState('');
	const pending = useRef(false);
	const dirty = workspace !== null && workspace.project.revision !== savedRevision;
	const menu = useRef<HTMLDetailsElement>(null);

	useEffect(() => {
		if (!dirty) return;
		const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener('beforeunload', onUnload);
		return () => window.removeEventListener('beforeunload', onUnload);
	}, [dirty]);

	function run(work: () => Promise<void>): void {
		if (pending.current) return;
		pending.current = true;
		setBusy(true);
		setFailure('');
		setStatus('');
		if (menu.current) menu.current.open = false;
		void work().catch((error: unknown) => {
			setFailure(error instanceof Error ? error.message : String(error));
		}).finally(() => {
			pending.current = false;
			setBusy(false);
		});
	}

	function confirmReplacement(): boolean {
		return !dirty || window.confirm('Close the current project and discard unsaved changes?');
	}

	function open(kind: 'open' | 'create'): void {
		if (!confirmReplacement()) return;
		run(async () => {
			const opened = await bridge.request(kind === 'create' ? { kind, sampleRate: 48_000 } : { kind });
			if (!opened) return;
			const next = await readTracktionWorkspace(bridge, opened);
			setWorkspace(next);
			if (opened.sessionId !== workspace?.sessionId) setSavedRevision(next.project.revision);
		});
	}

	function close(): void {
		if (!workspace || !confirmReplacement()) return;
		run(async () => {
			await bridge.request({ kind: 'close', sessionId: workspace.sessionId });
			setWorkspace(null);
			setSavedRevision(null);
		});
	}

	function save(): void {
		if (!workspace) return;
		run(async () => {
			const result = await bridge.request({ kind: 'save', sessionId: workspace.sessionId, revision: workspace.project.revision });
			setSavedRevision(result.revision);
			setStatus(copy.projectSaved);
		});
	}

	function importWave(): void {
		if (!workspace?.selectedTrack) return;
		const trackId = workspace.selectedTrack.id;
		const start = workspace.clips.reduce((end, clip) => Math.max(end, clip.end), 0);
		run(async () => {
			const result = await bridge.request({
				kind: 'import', sessionId: workspace.sessionId, revision: workspace.project.revision, trackId, start,
			});
			if (result) setWorkspace(await readTracktionWorkspace(bridge, workspace, trackId));
		});
	}

	return <>
		<nav aria-label="Application menu">
			<details ref={menu}>
				<summary>File</summary>
				<div>
					<button type="button" disabled={busy} onClick={() => open('create')}>{copy.newProject}</button>
					<button type="button" disabled={busy} onClick={() => open('open')}>{copy.openProject}</button>
					<button type="button" disabled={busy || !workspace?.selectedTrack} onClick={importWave}>{copy.importAudio}</button>
					<button type="button" disabled={busy || !workspace} onClick={save}>{copy.saveProject}</button>
					<button type="button" disabled={busy || !workspace} onClick={close}>{copy.closeProject}</button>
				</div>
			</details>
		</nav>
		<main aria-busy={busy}>
			<h1>{workspace?.name ?? 'Soundscaper Tracktion'}</h1>
			{status && <p role="status">{status}</p>}
			{failure && <p role="alert">{failure}</p>}
			{workspace && <>
				<label>{TRACK_COPY_BY_LOCALE.en.track} <select value={workspace.selectedTrack?.id ?? ''} disabled={busy} onChange={(event) => {
					const trackId = event.currentTarget.value;
					run(async () => setWorkspace(await readTracktionWorkspace(bridge, workspace, trackId)));
				}}>
					{workspace.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
				</select></label>
				<p>{workspace.clips.length} {workspace.clips.length === 1 ? 'clip' : 'clips'}</p>
				<ul aria-label="Audio clips">
					{workspace.clips.map((clip) => <li key={clip.id}>{clip.name} ({clip.start}–{clip.end})</li>)}
				</ul>
			</>}
		</main>
	</>;
}
