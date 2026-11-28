/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useState } from 'react';

import { EDIT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/edit-command-copy.js';
import { CLIP_INTERACTIONS_COPY_BY_LOCALE } from '../../common/i18n/editor-clip-interactions-copy.ts';
import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import type { TracktionClipCommand, TracktionClipView, TracktionTrackView } from '../tracktion-project-contract.ts';
import { TracktionEditForm } from './TracktionEditForm.tsx';
import { useTracktionModalDialog } from './useTracktionModalDialog.ts';

const copy = EDIT_COMMAND_COPY_BY_LOCALE.en;
const titles: Record<TracktionClipCommand['kind'], string> = {
	split: copy.tracktionSplitClip, trim: copy.tracktionTrimClip, moveClip: copy.tracktionMoveClip,
	duplicateClip: copy.tracktionDuplicateClip, deleteClip: copy.liftDelete,
};

export function TracktionClipEditDialog({ kind, clips, tracks, sourceTrackId, busy, failure, onApply, onDismiss }: {
	readonly kind: TracktionClipCommand['kind'];
	readonly clips: readonly TracktionClipView[];
	readonly tracks: readonly TracktionTrackView[];
	readonly sourceTrackId: string;
	readonly busy: boolean;
	readonly failure: string;
	readonly onApply: (edit: TracktionClipCommand) => void;
	readonly onDismiss: () => void;
}) {
	const dialog = useTracktionModalDialog();
	const [id, setId] = useState(clips[0]?.id);
	const [validation, setValidation] = useState('');
	const clip = clips.find((candidate) => candidate.id === id) ?? clips[0];
	const placing = kind === 'moveClip' || kind === 'duplicateClip';
	const title = titles[kind];
	const clipOptions = useMemo(() => clips.map((item) => (
		<option key={item.id} value={item.id}>{item.name} ({item.start}–{item.end})</option>)), [clips]);
	const destinationOptions = useMemo(() => placing && tracks.map((track) => (
		<option key={track.id} value={track.id}>{track.name}</option>)), [placing, tracks]);


	function apply(fields: FormData): void {
		if (busy || !clip) return;
		if (kind === 'deleteClip') {
			onApply({ kind, clipId: clip.id });
			return;
		}
		if (kind === 'split') {
			onApply({ kind, clipId: clip.id, frame: Number(fields.get('frame')) });
			return;
		}
		const start = Number(fields.get('start'));
		if (placing) {
			onApply({ kind, clipId: clip.id, trackId: String(fields.get('track')), start });
			return;
		}
		const end = Number(fields.get('end'));
		if (start >= end) {
			setValidation(copy.tracktionClipFrameOrder);
			return;
		}
		onApply({ kind, clipId: clip.id, start, end });
	}

	if (!clip) return null;
	return <dialog ref={dialog} aria-label={title} onCancel={(event) => {
		event.preventDefault();
		if (!busy) onDismiss();
	}}>
		<h2>{title}</h2>
		<TracktionEditForm onApply={apply} onInput={() => setValidation('')}>
			<p><label>{copy.tracktionClip} <select value={clip.id} disabled={busy} onChange={(event) => { setId(event.currentTarget.value); }}>
				{clipOptions}
			</select></label></p>
			<div key={clip.id}>
				{kind === 'split' && <p><label>{copy.tracktionSplitFrame} <input type="number" name="frame" required step="1" disabled={busy}
					min={clip.start + 1} max={clip.end - 1} defaultValue={clip.start + Math.floor((clip.end - clip.start) / 2)} />
				</label></p>}
				{kind === 'trim' && <>
					<p><label>{copy.tracktionStartFrame} <input type="number" name="start" required step="1" disabled={busy}
						min={clip.start} max={clip.end - 1} defaultValue={clip.start} /></label></p>
					<p><label>{copy.tracktionEndFrame} <input type="number" name="end" required step="1" disabled={busy}
						min={clip.start + 1} max={clip.end} defaultValue={clip.end} /></label></p>
				</>}
				{placing && <>
					<p><label>{copy.tracktionDestinationTrack} <select name="track" defaultValue={sourceTrackId} disabled={busy}>
						{destinationOptions}
					</select></label></p>
					<p><label>{copy.tracktionStartFrame} <input type="number" name="start" required step="1" min="0" disabled={busy}
						defaultValue={kind === 'duplicateClip' ? clip.end : clip.start} /></label></p>
				</>}
			</div>
			{(validation || failure) && <p role="alert">{validation || failure}</p>}
			<button type="submit" disabled={busy}>{CLIP_INTERACTIONS_COPY_BY_LOCALE.en.apply}</button>{' '}
			<button type="button" disabled={busy} onClick={onDismiss}>{PROJECT_COMMAND_COPY_BY_LOCALE.en.cancel}</button>
		</TracktionEditForm>
	</dialog>;
}
