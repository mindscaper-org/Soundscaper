/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { EDIT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/edit-command-copy.js';
import { CLIP_INTERACTIONS_COPY_BY_LOCALE } from '../../common/i18n/editor-clip-interactions-copy.ts';
import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import type { TracktionRangeCommand } from '../tracktion-project-contract.ts';

const copy = EDIT_COMMAND_COPY_BY_LOCALE.en;
const choices = {
	deleteRange: { title: copy.tracktionDeleteRange, label: copy.tracktionRangeDeleteMode, modes: {
		leaveGap: copy.deleteLeaveGap, perClip: copy.deletePerClipRipple,
		track: copy.deletePerTrackRipple, allTracks: copy.deleteAllTracksRipple,
	} },
	cutRange: { title: copy.cut, label: copy.tracktionCutMode, modes: {
		leaveGap: copy.cutLeaveGap, perClip: copy.cutPerClipRipple,
		track: copy.cutPerTrackRipple, allTracks: copy.cutAllTracksRipple,
	} },
	copyRange: { title: copy.copy, label: copy.tracktionCopyScope, modes: {
		leaveGap: copy.tracktionActiveAudioTrack, allTracks: copy.tracktionAllAudioTracks,
	} },
};

export function TracktionRangeEditDialog({ kind, trackId, onApply, onDismiss }: {
	readonly kind: TracktionRangeCommand['kind'];
	readonly trackId: string;
	readonly onApply: (edit: TracktionRangeCommand) => void;
	readonly onDismiss: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [failure, setFailure] = useState('');
	const { title, label, modes } = choices[kind];
	useEffect(() => { dialog.current?.showModal(); }, []);

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		const fields = new FormData(event.currentTarget);
		const start = Number(fields.get('start'));
		const end = Number(fields.get('end'));
		if (start >= end) {
			setFailure(copy.tracktionClipFrameOrder);
			return;
		}
		const mode = fields.get('mode') as TracktionRangeCommand['mode'];
		const range = { kind, start, end };
		onApply(mode === 'allTracks' ? { ...range, mode, trackId: null } : { ...range, mode, trackId });
	}

	return <dialog ref={dialog} aria-label={title} onCancel={onDismiss}>
		<h2>{title}</h2>
		<form onSubmit={submit} onInput={() => setFailure('')}>
			<p><label>{copy.tracktionStartFrame} <input type="number" name="start" min="0" step="1" required /></label></p>
			<p><label>{copy.tracktionEndFrame} <input type="number" name="end" min="1" step="1" required /></label></p>
			<p><label>{label} <select name="mode" defaultValue="leaveGap">
				{Object.entries(modes).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
			</select></label></p>
			{failure && <p role="alert">{failure}</p>}
			<button type="submit">{CLIP_INTERACTIONS_COPY_BY_LOCALE.en.apply}</button>{' '}
			<button type="button" onClick={onDismiss}>{PROJECT_COMMAND_COPY_BY_LOCALE.en.cancel}</button>
		</form>
	</dialog>;
}
