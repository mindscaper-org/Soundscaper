/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { EDIT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/edit-command-copy.js';
import { CLIP_INTERACTIONS_COPY_BY_LOCALE } from '../../common/i18n/editor-clip-interactions-copy.ts';
import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import type { TracktionRangeCommand } from '../tracktion-project-contract.ts';

const copy = EDIT_COMMAND_COPY_BY_LOCALE.en;
const modes = {
	leaveGap: copy.deleteLeaveGap,
	perClip: copy.deletePerClipRipple,
	track: copy.deletePerTrackRipple,
	allTracks: copy.deleteAllTracksRipple,
};

export function TracktionRangeDeleteDialog({ trackId, onApply, onDismiss }: {
	readonly trackId: string;
	readonly onApply: (edit: TracktionRangeCommand) => void;
	readonly onDismiss: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [failure, setFailure] = useState('');
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
		const range = { kind: 'deleteRange', start, end } as const;
		onApply(mode === 'allTracks' ? { ...range, mode, trackId: null } : { ...range, mode, trackId });
	}

	return <dialog ref={dialog} aria-label={copy.tracktionDeleteRange} onCancel={onDismiss}>
		<h2>{copy.tracktionDeleteRange}</h2>
		<form onSubmit={submit} onInput={() => setFailure('')}>
			<p><label>{copy.tracktionStartFrame} <input type="number" name="start" min="0" step="1" required /></label></p>
			<p><label>{copy.tracktionEndFrame} <input type="number" name="end" min="1" step="1" required /></label></p>
			<p><label>{copy.tracktionRangeDeleteMode} <select name="mode" defaultValue="leaveGap">
				{Object.entries(modes).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
			</select></label></p>
			{failure && <p role="alert">{failure}</p>}
			<button type="submit">{CLIP_INTERACTIONS_COPY_BY_LOCALE.en.apply}</button>{' '}
			<button type="button" onClick={onDismiss}>{PROJECT_COMMAND_COPY_BY_LOCALE.en.cancel}</button>
		</form>
	</dialog>;
}
