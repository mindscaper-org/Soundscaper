/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import type { RepeatedSoundOptions } from '../../repeated-sound.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';

interface Props {
	readonly controller: {
		readonly actions: { readonly analysis: {
			findRepeatedSound(options: RepeatedSoundOptions, signal?: AbortSignal): Promise<unknown>;
		} };
	};
	readonly snapshot: AudioEditorEditBlockingSnapshot & {
		readonly project?: { readonly id: string } | null;
		readonly ready?: boolean;
		readonly lastAnalysisRequest?: { readonly options?: RepeatedSoundOptions } | null;
	};
	readonly copy: Readonly<Record<string, string>>;
	readonly repeat?: boolean;
	readonly onClose: () => void;
}

export default function RepeatedSoundDialog({ controller, snapshot, copy, repeat = false, onClose }: Props) {
	const session = editorProjectEditSessionKey(controller, snapshot.project?.id);
	const [openedSession] = useState(session);
	const [threshold, setThreshold] = useState(String((repeat ? snapshot.lastAnalysisRequest?.options?.similarityThreshold ?? .9 : .9) * 100));
	const [busy, setBusy] = useState(false), [error, setError] = useState('');
	const pending = useRef<AbortController | null>(null), repeated = useRef(false);
	const blocked = selectAudioEditorEditBlock(snapshot).blocked || !snapshot.ready || !snapshot.project;
	useEffect(() => () => { pending.current?.abort(); pending.current = null; }, [session]);
	useEffect(() => { if (session !== openedSession) onClose(); }, [session, openedSession, onClose]);
	const close = (): void => { pending.current?.abort(); onClose(); };
	const create = useCallback((): void => {
		if (blocked || pending.current || session !== openedSession) return;
		const cancellation = new AbortController();
		pending.current = cancellation; setBusy(true); setError('');
		void Promise.resolve().then(() => controller.actions.analysis.findRepeatedSound({ similarityThreshold: Number(threshold) / 100 }, cancellation.signal))
			.then(() => { if (!cancellation.signal.aborted) onClose(); })
			.catch((cause: unknown) => { if (!cancellation.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
			.finally(() => {
				if (pending.current === cancellation) { pending.current = null; setBusy(false); }
			});
	}, [blocked, controller, onClose, openedSession, session, threshold]);
	useEffect(() => {
		if (repeat && !repeated.current) { repeated.current = true; create(); }
	}, [create, repeat]);
	return <AudioEditorDialogShell title={copy.findRepeatedSound!} onClose={close} width={560}
		dataAttributes={{ 'data-analysis-mode': 'repeated-sound' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={close}>{copy.cancel}</Button>
			<Button variant="primary" type="submit" form="find-repeated-sound-form" disabled={blocked || busy}>{copy.repeatedSoundCreate}</Button>
		</>} />}>
		<form id="find-repeated-sound-form" className="kw-audio-editor-dialog__form" aria-busy={busy}
			onSubmit={event => { event.preventDefault(); create(); }}>
			<p className="audio-editor-panel-hint">{copy.repeatedSoundInstructions}</p>
			<label className="kw-audio-editor-dialog__field"><span>{copy.repeatedSoundThreshold}</span>
				<input required type="number" min={50} max={100} step={.1} value={threshold} disabled={busy}
					onChange={event => setThreshold(event.currentTarget.value)} />
			</label>
			{busy && <p role="status">{copy.analysisRendering}</p>}
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
		</form>
	</AudioEditorDialogShell>;
}
