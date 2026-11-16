/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import type { createDialogueAlignmentComposition } from '../../controller/track-audio/dialogue-alignment-composition.ts';
import { dialogueAlignmentTargets, type DialogueTargetProject } from '../../dialogue-alignment-targets.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

export interface DialogueAlignmentDialogProps {
	readonly controller: { readonly actions: { readonly dialogueAlignment: ReturnType<typeof createDialogueAlignmentComposition> } };
	readonly snapshot: AudioEditorEditBlockingSnapshot & { readonly project?: (DialogueTargetProject & { readonly id: string;
		readonly revision?: unknown; readonly selection?: { readonly clipIds?: readonly string[] } | null }) | null; readonly ready?: boolean; readonly selectedClipId?: string | null };
	readonly copy: Readonly<Record<string, string>>;
	readonly onClose: () => void;
}

export default function DialogueAlignmentDialog({ controller, snapshot, copy, onClose }: DialogueAlignmentDialogProps) {
	const actions = controller.actions.dialogueAlignment, project = snapshot.project;
	const targets = dialogueAlignmentTargets(project ?? null);
	const selected = project?.selection?.clipIds ?? [];
	const initial = targets.filter(target => selected.includes(target.clipId));
	const [reference, setReference] = useState(initial[0]?.clipId ?? targets.find(target => target.clipId === snapshot.selectedClipId)?.clipId ?? targets[0]?.clipId ?? '');
	const [replacement, setReplacement] = useState(initial[1]?.clipId ?? targets.find(target => target.clipId !== reference)?.clipId ?? '');
	const [strength, setStrength] = useState('100'), [busy, setBusy] = useState(false);
	const [review, setReview] = useState<Awaited<ReturnType<typeof actions.prepare>> | null>(null);
	const [error, setError] = usePresentationFeedback(copy);
	const pending = useRef<AbortController | null>(null), mounted = useRef(true);
	const pendingKind = useRef<'prepare' | 'preview' | 'apply' | null>(null);
	const session = editorProjectEditSessionKey(controller, project?.id), [openedSession] = useState(session);
	const [revision] = useState(project?.revision);
	const stale = project?.revision !== revision;
	const blocked = selectAudioEditorEditBlock(snapshot).blocked || !snapshot.ready || !project || stale;
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); void actions.discard().catch(() => undefined); }; }, [actions, session]);
	useEffect(() => { if (session !== openedSession) onClose(); }, [session, openedSession, onClose]);
	useEffect(() => {
		// Acceptance publishes its own revision before its promise settles.
		if (stale && pendingKind.current !== 'apply') { pending.current?.abort(); setReview(null); void actions.discard().catch(() => undefined); }
	}, [actions, stale, busy]);
	const close = (): void => { pending.current?.abort(); onClose(); };
	const reset = (): void => { setReview(null); setError(''); void actions.discard().catch(() => undefined); };
	const run = <Result,>(operation: (signal: AbortSignal) => Promise<Result>, success: (result: Result) => void,
		kind: 'prepare' | 'preview' | 'apply' = 'preview'): void => {
		if (pending.current || session !== openedSession || stale) return;
		const cancellation = new AbortController(); pending.current = cancellation; pendingKind.current = kind; setBusy(true); setError('');
		void Promise.resolve().then(() => operation(cancellation.signal)).then(result => {
			if (mounted.current && !cancellation.signal.aborted) success(result);
		}).catch((cause: unknown) => { if (mounted.current && !cancellation.signal.aborted) setError(feedbackFailure(cause)); })
			.finally(() => { if (pending.current === cancellation) { pending.current = null; pendingKind.current = null; if (mounted.current) setBusy(false); } });
	};
	const ready = !blocked && !busy && targets.some(target => target.clipId === reference)
		&& targets.some(target => target.clipId === replacement) && reference !== replacement;
	return <AudioEditorDialogShell title={copy.dialogueAlignmentTitle!} onClose={close} width={600}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={close}>{copy.cancel}</Button>
			<Button variant="primary" disabled={!ready || !review} onClick={() => {
				if (review) run(signal => actions.apply(review.id, signal), () => onClose(), 'apply');
			}}>{copy.dialogueAlignmentApply}</Button>
		</>} />}>
		<form className="kw-audio-editor-dialog__form" aria-busy={busy} onSubmit={event => {
			event.preventDefault();
			if (ready) run(signal => actions.prepare({ referenceClipId: reference, replacementClipId: replacement, strength: Number(strength) / 100 }, signal), setReview, 'prepare');
		}}>
			<p className="audio-editor-panel-hint">{copy.dialogueAlignmentInstructions}</p>
			<p className="audio-editor-panel-hint">{copy.dialogueAlignmentPreservation}</p>
			<label className="kw-audio-editor-dialog__field"><span>{copy.dialogueAlignmentReference}</span>
				<select value={reference} disabled={busy} onChange={event => { reset(); setReference(event.currentTarget.value); }}>
					{targets.map(target => <option key={target.clipId} value={target.clipId}>{target.title}</option>)}
				</select>
			</label>
			<label className="kw-audio-editor-dialog__field"><span>{copy.dialogueAlignmentReplacement}</span>
				<select value={replacement} disabled={busy} onChange={event => { reset(); setReplacement(event.currentTarget.value); }}>
					{targets.map(target => <option key={target.clipId} value={target.clipId}>{target.title}</option>)}
				</select>
			</label>
			<label className="kw-audio-editor-dialog__field"><span>{copy.dialogueAlignmentStrength}</span>
				<input type="number" required min={0} max={100} step={1} value={strength} disabled={busy}
					onChange={event => { reset(); setStrength(event.currentTarget.value); }} />
			</label>
			<p className="audio-editor-panel-hint">{copy.dialogueAlignmentStrengthHint}</p>
			<Button variant="secondary" type="submit" disabled={!ready}>{copy.dialogueAlignmentAnalyze}</Button>
			{review && <>
				<p role="status">{review.mismatch > .25 ? copy.dialogueAlignmentUncertain : copy.dialogueAlignmentReady}</p>
				<div className="audio-editor-dialog-footer">
					{(['reference', 'replacement', 'aligned'] as const).map((kind, index) => <Button key={kind} variant="secondary" disabled={!ready}
						onClick={() => run(() => actions.preview(review.id, kind), () => {})}>{[copy.dialogueAlignmentPreviewReference, copy.dialogueAlignmentPreviewReplacement, copy.dialogueAlignmentPreviewAligned][index]}</Button>)}
					<Button variant="secondary" onClick={() => run(() => actions.stopPreview(), () => {})}>{copy.dialogueAlignmentStop}</Button>
				</div>
			</>}
			{busy && <p role="status">{copy.dialogueAlignmentWorking}</p>}
			{stale && <p role="alert">{copy.dialogueAlignmentStale}</p>}
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
		</form>
	</AudioEditorDialogShell>;
}
