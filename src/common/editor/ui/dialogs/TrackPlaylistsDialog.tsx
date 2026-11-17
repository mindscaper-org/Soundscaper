/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import type { createTrackPlaylistActionFacade } from '../../controller/track-audio/track-playlist-action-facade.ts';
import { readTrackPlaylists, TRACK_PLAYLIST_LIMIT, TRACK_PLAYLIST_NAME_LIMIT } from '../../track-playlists.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import { resolveTrackPlaylistCopy } from '../../../i18n/editor-track-playlist-copy.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import EditorControlLabel from '../EditorControlLabel.tsx';

interface Props {
	readonly controller: { readonly actions: { readonly trackPlaylists: ReturnType<typeof createTrackPlaylistActionFacade> } };
	readonly snapshot: AudioEditorEditBlockingSnapshot & {
		readonly ready?: boolean; readonly selectedTrackId?: string | null;
		readonly project?: { readonly id: string; readonly tracks: readonly Readonly<{
			id: string; name: string; type: string; locked?: unknown; audioFreeze?: unknown;
		}>[] } | null;
	};
	readonly copy: Readonly<Record<string, string>>;
	readonly onClose: () => void;
}

export default function TrackPlaylistsDialog({ controller, snapshot, copy, onClose }: Props) {
	const text = resolveTrackPlaylistCopy(copy), actions = controller.actions.trackPlaylists;
	const [trackId] = useState(snapshot.selectedTrackId);
	const track = snapshot.project?.tracks.find(entry => entry.id === trackId);
	const collection = readTrackPlaylists(snapshot.project).find(entry => entry.trackId === trackId);
	const playlists = collection?.playlists ?? [];
	const [selectedId, setSelectedId] = useState(collection?.activeId ?? '');
	const [name, setName] = useState(''), [busy, setBusy] = useState(false);
	const [error, setError] = usePresentationFeedback(copy);
	const pending = useRef(false), mounted = useRef(true);
	const sessionKey = editorProjectEditSessionKey(controller, snapshot.project?.id), [openedSession] = useState(sessionKey);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	useEffect(() => { if (sessionKey !== openedSession || !track) onClose(); }, [sessionKey, openedSession, track, onClose]);
	const blocked = !snapshot.ready || !track || track.type !== 'audio' || Boolean(track.locked || track.audioFreeze)
		|| selectAudioEditorEditBlock(snapshot).blocked || busy || sessionKey !== openedSession;
	const selected = playlists.find(entry => entry.id === selectedId), active = selectedId === collection?.activeId;
	const validName = Boolean(name.trim()) && name.trim().length <= TRACK_PLAYLIST_NAME_LIMIT;
	const canCreate = validName && playlists.length < TRACK_PLAYLIST_LIMIT;
	function perform(operation: () => unknown | PromiseLike<unknown>): void {
		if (blocked || pending.current || !trackId) return;
		pending.current = true; setBusy(true); setError('');
		void Promise.resolve().then(operation).catch((cause: unknown) => {
			if (mounted.current) setError(feedbackFailure(cause));
		}).finally(() => { pending.current = false; if (mounted.current) setBusy(false); });
	}
	function create(mode: 'empty' | 'duplicate'): void {
		if (!canCreate || !trackId) return;
		perform(async () => {
			const id = await actions.create(trackId, name, mode, text.original);
			if (mounted.current) setSelectedId(id);
		});
	}
	const close = (): void => { if (!pending.current) onClose(); };
	return <AudioEditorDialogShell title={text.title} onClose={close} closeOnEscape={!busy} width={580}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={
			<Button variant="secondary" disabled={busy} onClick={close}>{text.close}</Button>
		} />}>
		<form className="kw-audio-editor-dialog__form" aria-busy={busy} onSubmit={event => { event.preventDefault(); create('duplicate'); }}>
			<p><strong>{track?.name}</strong></p>
			<p className="audio-editor-panel-hint">{text.instructions}</p>
			<label className="kw-audio-editor-dialog__field"><EditorControlLabel>{text.name}</EditorControlLabel>
				<input type="text" value={name} maxLength={TRACK_PLAYLIST_NAME_LIMIT} disabled={blocked}
					onChange={event => setName(event.currentTarget.value)} />
			</label>
			<div className="audio-editor-dialog-footer">
				<Button variant="primary" type="submit" disabled={blocked || !canCreate}>{text.duplicate}</Button>
				<Button variant="secondary" disabled={blocked || !canCreate} onClick={() => create('empty')}>{text.create}</Button>
			</div>
			{playlists.length === 0 ? <p>{text.empty}</p> : <>
				<label className="kw-audio-editor-dialog__field"><EditorControlLabel>{text.list}</EditorControlLabel>
					<select size={Math.min(8, Math.max(2, playlists.length))} value={selected?.id ?? ''} disabled={blocked}
						onChange={event => { const id = event.currentTarget.value; setSelectedId(id); setName(playlists.find(entry => entry.id === id)?.name ?? ''); }}>
						{playlists.map(entry => <option key={entry.id} value={entry.id}>
							{entry.name}{entry.id === collection?.activeId ? ` (${text.active})` : ''}
						</option>)}
					</select>
				</label>
				<div className="audio-editor-dialog-footer">
					<Button variant="secondary" disabled={blocked || !selected || active} onClick={() => perform(() => actions.activate(trackId!, selectedId))}>{text.activate}</Button>
					<Button variant="secondary" disabled={blocked || !selected || !validName || name.trim() === selected.name}
						onClick={() => perform(() => actions.rename(trackId!, selectedId, name))}>{text.rename}</Button>
					<Button variant="secondary" disabled={blocked || !selected || active}
						onClick={() => perform(() => { actions.remove(trackId!, selectedId); setSelectedId(collection?.activeId ?? ''); setName(''); })}>{text.remove}</Button>
				</div>
			</>}
			{error && <p role="alert">{error}</p>}
		</form>
	</AudioEditorDialogShell>;
}
