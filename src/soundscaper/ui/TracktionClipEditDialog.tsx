/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { EDIT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/edit-command-copy.js';
import { CLIP_INTERACTIONS_COPY_BY_LOCALE } from '../../common/i18n/editor-clip-interactions-copy.ts';
import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import type { TracktionClipView } from '../tracktion-project-contract.ts';

export type TracktionClipEdit = Readonly<{ kind: 'split'; clipId: string; frame: number }>
	| Readonly<{ kind: 'trim'; clipId: string; start: number; end: number }>;

const copy = EDIT_COMMAND_COPY_BY_LOCALE.en;

export function TracktionClipEditDialog({ kind, clips, onApply, onDismiss }: {
	readonly kind: TracktionClipEdit['kind'];
	readonly clips: readonly TracktionClipView[];
	readonly onApply: (edit: TracktionClipEdit) => void;
	readonly onDismiss: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [id, setId] = useState(clips[0]?.id);
	const [failure, setFailure] = useState('');
	const clip = clips.find((candidate) => candidate.id === id) ?? clips[0];
	const splitting = kind === 'split';
	const title = splitting ? copy.tracktionSplitClip : copy.tracktionTrimClip;

	useEffect(() => { dialog.current?.showModal(); }, []);

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		if (!clip) return;
		const fields = new FormData(event.currentTarget);
		if (splitting) {
			onApply({ kind, clipId: clip.id, frame: Number(fields.get('frame')) });
			return;
		}
		const start = Number(fields.get('start'));
		const end = Number(fields.get('end'));
		if (start >= end) {
			setFailure(copy.tracktionClipFrameOrder);
			return;
		}
		onApply({ kind, clipId: clip.id, start, end });
	}

	if (!clip) return null;
	return <dialog ref={dialog} aria-label={title} onCancel={onDismiss}>
		<h2>{title}</h2>
		<form onSubmit={submit} onInput={() => setFailure('')}>
			<p><label>{copy.tracktionClip} <select value={clip.id} onChange={(event) => { setId(event.currentTarget.value); }}>
				{clips.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.start}–{item.end})</option>)}
			</select></label></p>
			<div key={clip.id}>
				{splitting ? <p><label>{copy.tracktionSplitFrame} <input type="number" name="frame" required step="1"
					min={clip.start + 1} max={clip.end - 1} defaultValue={clip.start + Math.floor((clip.end - clip.start) / 2)} />
				</label></p> : <>
					<p><label>{copy.tracktionStartFrame} <input type="number" name="start" required step="1"
						min={clip.start} max={clip.end - 1} defaultValue={clip.start} /></label></p>
					<p><label>{copy.tracktionEndFrame} <input type="number" name="end" required step="1"
						min={clip.start + 1} max={clip.end} defaultValue={clip.end} /></label></p>
				</>}
			</div>
			{failure && <p role="alert">{failure}</p>}
			<button type="submit">{CLIP_INTERACTIONS_COPY_BY_LOCALE.en.apply}</button>{' '}
			<button type="button" onClick={onDismiss}>{PROJECT_COMMAND_COPY_BY_LOCALE.en.cancel}</button>
		</form>
	</dialog>;
}
