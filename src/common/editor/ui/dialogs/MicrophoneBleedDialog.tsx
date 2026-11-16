/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import PluginEffectPresetHeader from '../inspector/PluginEffectPresetHeader.tsx';
import { pluginEffectType } from '../../effect-plugin-identity.ts';
import { normalizeMicrophoneBleedOptions, type MicrophoneBleedOptions } from '../../microphone-bleed.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import EditorControlLabel from '../EditorControlLabel.tsx';

interface Props {
	readonly controller: { readonly actions: { readonly effects: {
		reduceMicrophoneBleed(options: MicrophoneBleedOptions, signal?: AbortSignal): Promise<{ changedClipCount: number }>;
	} } };
	readonly snapshot: AudioEditorEditBlockingSnapshot & { readonly project?: { readonly id: string } | null; readonly ready?: boolean };
	readonly copy: Readonly<Record<string, string>>;
	readonly onClose: () => void;
}

export default function MicrophoneBleedDialog({ controller, snapshot, copy, onClose }: Props) {
	const session = editorProjectEditSessionKey(controller, snapshot.project?.id), [openedSession] = useState(session);
	const [reduction, setReduction] = useState('12'), [similarity, setSimilarity] = useState('90'), [fade, setFade] = useState('80');
	const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
	const pending = useRef<AbortController | null>(null);
	const blocked = selectAudioEditorEditBlock(snapshot).blocked || !snapshot.ready || !snapshot.project;
	useEffect(() => () => { pending.current?.abort(); pending.current = null; }, [session]);
	useEffect(() => { if (session !== openedSession) onClose(); }, [session, openedSession, onClose]);
	const close = (): void => { pending.current?.abort(); onClose(); };
	const apply = (): void => {
		if (blocked || pending.current || session !== openedSession) return;
		const cancellation = new AbortController();
		pending.current = cancellation; setBusy(true); setError(''); setStatus('');
		void Promise.resolve().then(() => controller.actions.effects.reduceMicrophoneBleed({ maximumReductionDb: Number(reduction),
			minimumSimilarity: Number(similarity) / 100, fadeMs: Number(fade) }, cancellation.signal))
			.then(result => { if (!cancellation.signal.aborted) { if (result.changedClipCount) onClose(); else setStatus(copy.microphoneBleedUnchanged!); } })
			.catch((cause: unknown) => { if (!cancellation.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
			.finally(() => { if (pending.current === cancellation) { pending.current = null; setBusy(false); } });
	};
	return <AudioEditorDialogShell title={copy.microphoneBleedTitle!} onClose={close} width={600}
		headerSlot={<PluginEffectPresetHeader controller={controller} copy={copy} effectType={pluginEffectType('selection', 'microphone-bleed')}
			name={copy.microphoneBleedTitle!} resetKey={session} disabled={blocked || busy} realtime={false}
			currentParams={{ maximumReductionDb: Number(reduction), minimumSimilarity: Number(similarity) / 100, fadeMs: Number(fade) }}
			defaultParams={normalizeMicrophoneBleedOptions()}
			read={() => normalizeMicrophoneBleedOptions({ maximumReductionDb: Number(reduction), minimumSimilarity: Number(similarity) / 100, fadeMs: Number(fade) })}
			apply={params => { const value = normalizeMicrophoneBleedOptions(params as MicrophoneBleedOptions);
				setReduction(String(value.maximumReductionDb)); setSimilarity(String(value.minimumSimilarity * 100)); setFade(String(value.fadeMs)); }} />}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={close}>{copy.cancel}</Button>
			<Button variant="primary" type="submit" form="microphone-bleed-form" disabled={blocked || busy}>{copy.microphoneBleedApply}</Button>
		</>} />}>
		<form id="microphone-bleed-form" className="kw-audio-editor-dialog__form" aria-busy={busy}
			onSubmit={event => { event.preventDefault(); apply(); }}>
			<p className="audio-editor-panel-hint">{copy.microphoneBleedInstructions}</p>
			<p className="audio-editor-panel-hint">{copy.microphoneBleedEditable}</p>
			<label className="kw-audio-editor-dialog__field"><EditorControlLabel>{copy.microphoneBleedReduction}</EditorControlLabel>
				<input required type="number" min={0} max={36} step={1} value={reduction} disabled={busy} onChange={event => setReduction(event.currentTarget.value)} />
			</label>
			<label className="kw-audio-editor-dialog__field"><EditorControlLabel>{copy.microphoneBleedSimilarity}</EditorControlLabel>
				<input required type="number" min={50} max={100} step={1} value={similarity} disabled={busy} onChange={event => setSimilarity(event.currentTarget.value)} />
			</label>
			<p className="audio-editor-panel-hint">{copy.microphoneBleedSimilarityHint}</p>
			<label className="kw-audio-editor-dialog__field"><EditorControlLabel>{copy.microphoneBleedFade}</EditorControlLabel>
				<input required type="number" min={20} max={500} step={10} value={fade} disabled={busy} onChange={event => setFade(event.currentTarget.value)} />
			</label>
			{busy && <p role="status">{copy.audacityProcessing}</p>}
			{status && <p role="status">{status}</p>}
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
		</form>
	</AudioEditorDialogShell>;
}
