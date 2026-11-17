/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import type { createSessionSnapshotActionFacade } from '../../controller/document/session-snapshot-action-facade.ts';
import { readSessionSnapshots, SESSION_SNAPSHOT_LIMIT, SESSION_SNAPSHOT_NAME_LIMIT } from '../../session-snapshots.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import { resolveSessionSnapshotCopy } from '../../../i18n/editor-session-snapshot-copy.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import EditorControlLabel from '../EditorControlLabel.tsx';

interface Props {
	readonly controller: { readonly actions: { readonly sessionSnapshots: ReturnType<typeof createSessionSnapshotActionFacade> } };
	readonly snapshot: AudioEditorEditBlockingSnapshot & { readonly ready?: boolean; readonly project?: { readonly id: string } | null };
	readonly copy: Readonly<Record<string, string>>;
	readonly onClose: () => void;
}

export default function SessionSnapshotsDialog({ controller, snapshot, copy, onClose }: Props) {
	const text = resolveSessionSnapshotCopy(copy), actions = controller.actions.sessionSnapshots;
	const snapshots = readSessionSnapshots(snapshot.project);
	const [selectedId, setSelectedId] = useState(''), [name, setName] = useState(''), [busy, setBusy] = useState(false);
	const [error, setError] = usePresentationFeedback(copy);
	const pending = useRef(false), mounted = useRef(true);
	const sessionKey = editorProjectEditSessionKey(controller, snapshot.project?.id);
	const [openedSession] = useState(sessionKey);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	useEffect(() => { if (sessionKey !== openedSession) onClose(); }, [sessionKey, openedSession, onClose]);
	const blocked = !snapshot.ready || !snapshot.project || selectAudioEditorEditBlock(snapshot).blocked
		|| busy || sessionKey !== openedSession;
	const selected = snapshots.find(entry => entry.id === selectedId);
	const validName = Boolean(name.trim()) && name.trim().length <= SESSION_SNAPSHOT_NAME_LIMIT;
	function perform(operation: () => unknown | PromiseLike<unknown>): void {
		if (blocked || pending.current) return;
		pending.current = true; setBusy(true); setError('');
		void Promise.resolve().then(operation).catch((cause: unknown) => {
			if (mounted.current) setError(feedbackFailure(cause));
		}).finally(() => { pending.current = false; if (mounted.current) setBusy(false); });
	}
	const close = (): void => { if (!pending.current) onClose(); };
	return <AudioEditorDialogShell title={text.title} onClose={close} closeOnEscape={!busy} width={560}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={
			<Button variant="secondary" disabled={busy} onClick={close}>{text.close}</Button>
		} />}>
		<form className="kw-audio-editor-dialog__form" aria-busy={busy} onSubmit={event => {
			event.preventDefault();
			if (validName && snapshots.length < SESSION_SNAPSHOT_LIMIT) perform(async () => {
				const id = await actions.create(name);
				if (mounted.current) setSelectedId(id);
			});
		}}>
			<p className="audio-editor-panel-hint">{text.instructions}</p>
			<label className="kw-audio-editor-dialog__field"><EditorControlLabel>{text.name}</EditorControlLabel>
				<input type="text" value={name} required maxLength={SESSION_SNAPSHOT_NAME_LIMIT} disabled={blocked}
					onChange={event => setName(event.currentTarget.value)} />
			</label>
			<Button variant="primary" type="submit" disabled={blocked || !validName || snapshots.length >= SESSION_SNAPSHOT_LIMIT}>{text.create}</Button>
			{snapshots.length === 0 ? <p>{text.empty}</p> : <>
				<label className="kw-audio-editor-dialog__field"><EditorControlLabel>{text.list}</EditorControlLabel>
					<select size={Math.min(8, Math.max(2, snapshots.length))} value={selected?.id ?? ''} disabled={blocked}
						onChange={event => { const id = event.currentTarget.value; setSelectedId(id); setName(snapshots.find(entry => entry.id === id)?.name ?? ''); }}>
						{snapshots.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
					</select>
				</label>
				<div className="audio-editor-dialog-footer">
					<Button variant="secondary" disabled={blocked || !selected} onClick={() => perform(() => actions.restore(selectedId))}>{text.restore}</Button>
					<Button variant="secondary" disabled={blocked || !selected || !validName || name.trim() === selected.name}
						onClick={() => perform(() => actions.rename(selectedId, name))}>{text.rename}</Button>
					<Button variant="secondary" disabled={blocked || !selected} onClick={() => perform(() => { actions.remove(selectedId); setSelectedId(''); setName(''); })}>{text.remove}</Button>
				</div>
			</>}
			{error && <p role="alert">{error}</p>}
		</form>
	</AudioEditorDialogShell>;
}
