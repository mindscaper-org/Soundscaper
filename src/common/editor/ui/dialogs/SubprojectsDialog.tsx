/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import type { SubprojectActionFacade } from '../../controller/document/subproject-actions.ts';
import { readSubprojectLinks, SUBPROJECT_LIMIT } from '../../subprojects.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import { resolveSubprojectCopy } from '../../../i18n/editor-subproject-copy.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import EditorControlLabel from '../EditorControlLabel.tsx';

export interface SubprojectsDialogProps {
	readonly controller: { readonly actions: { readonly subprojects: SubprojectActionFacade } };
	readonly snapshot: AudioEditorEditBlockingSnapshot & { readonly ready?: boolean; readonly project?: { readonly id: string; readonly metadata?: unknown } | null };
	readonly copy: Readonly<Record<string, string>>;
	readonly onClose: () => void;
}

export default function SubprojectsDialog({ controller, snapshot, copy, onClose }: SubprojectsDialogProps) {
	const text = resolveSubprojectCopy(copy), actions = controller.actions.subprojects;
	const links = readSubprojectLinks(snapshot.project);
	const [candidates, setCandidates] = useState<readonly { id: string; title: string }[]>([]);
	const [libraryId, setLibraryId] = useState('');
	const [candidateId, setCandidateId] = useState(''), [selectedId, setSelectedId] = useState(''), [busy, setBusy] = useState(false);
	const [error, setError] = usePresentationFeedback(copy);
	const pending = useRef(false), mounted = useRef(true);
	const sessionKey = editorProjectEditSessionKey(controller, snapshot.project?.id);
	const [openedSession] = useState(sessionKey);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	useEffect(() => {
		let current = true;
		void Promise.all([actions.candidates(), actions.libraryId()]).then(([value, id]) => { if (current) { setCandidates(value); setLibraryId(id); } })
			.catch((cause: unknown) => { if (current) setError(feedbackFailure(cause)); });
		return () => { current = false; };
	}, [actions, setError]);
	useEffect(() => { if (sessionKey !== openedSession) onClose(); }, [sessionKey, openedSession, onClose]);
	const blocked = !snapshot.ready || !snapshot.project || selectAudioEditorEditBlock(snapshot).blocked || busy || sessionKey !== openedSession;
	const selected = links.find(link => link.id === selectedId);
	function perform(operation: () => unknown | PromiseLike<unknown>): void {
		if (blocked || pending.current) return;
		pending.current = true; setBusy(true); setError('');
		void Promise.resolve().then(operation).catch((cause: unknown) => {
			if (mounted.current) setError(feedbackFailure(cause));
		}).finally(() => { pending.current = false; if (mounted.current) setBusy(false); });
	}
	const close = (): void => { if (!pending.current) onClose(); };
	return <AudioEditorDialogShell title={text.title} onClose={close} closeOnEscape={!busy} width={600}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={busy} onClick={close}>{text.close}</Button>} />}>
		<div className="kw-audio-editor-dialog__form" aria-busy={busy}>
			<p className="audio-editor-panel-hint">{text.instructions}</p>
			<label className="kw-audio-editor-dialog__field"><EditorControlLabel>{text.candidate}</EditorControlLabel>
				<select value={candidateId} disabled={blocked} onChange={event => setCandidateId(event.currentTarget.value)}>
					<option value="">{text.choose}</option>
					{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
				</select>
			</label>
			<Button variant="primary" disabled={blocked || !candidateId || links.length >= SUBPROJECT_LIMIT} onClick={() => perform(() => actions.add(candidateId))}>{text.insert}</Button>
			{links.length === 0 ? <p>{text.empty}</p> : <>
				<label className="kw-audio-editor-dialog__field"><EditorControlLabel>{text.list}</EditorControlLabel>
					<select size={Math.min(8, Math.max(2, links.length))} value={selected?.id ?? ''} disabled={blocked} onChange={event => setSelectedId(event.currentTarget.value)}>
						{links.map(link => <option key={link.id} value={link.id}>{link.title} — {libraryId && link.libraryId !== libraryId ? text.relinkRequired : link.followLatest ? text.automatic : text.pinned}</option>)}
					</select>
				</label>
				<div className="audio-editor-dialog-footer">
					<Button variant="secondary" disabled={blocked || !selected} onClick={() => perform(() => actions.open(selectedId))}>{text.open}</Button>
					<Button variant="secondary" disabled={blocked || !selected} onClick={() => perform(() => actions.refresh({ id: selectedId, force: true }))}>{text.refresh}</Button>
					<Button variant="secondary" disabled={blocked || !selected} onClick={() => perform(() => actions.follow(selectedId, !selected?.followLatest))}>{selected?.followLatest ? text.pin : text.follow}</Button>
					<Button variant="secondary" disabled={blocked || !selected || !candidateId} onClick={() => perform(() => actions.relink(selectedId, candidateId))}>{text.relink}</Button>
					<Button variant="secondary" disabled={blocked || !selected} onClick={() => perform(() => actions.detach(selectedId))}>{text.detach}</Button>
				</div>
			</>}
			<p className="audio-editor-panel-hint">{text.portable}</p>
			{error && <p role="alert">{error}</p>}
		</div>
	</AudioEditorDialogShell>;
}
