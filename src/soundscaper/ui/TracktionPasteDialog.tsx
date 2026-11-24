/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type FormEvent } from 'react';

import { EDIT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/edit-command-copy.js';
import { CLIP_INTERACTIONS_COPY_BY_LOCALE } from '../../common/i18n/editor-clip-interactions-copy.ts';
import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import type { TracktionPasteCommand } from '../tracktion-project-contract.ts';

const copy = EDIT_COMMAND_COPY_BY_LOCALE.en;
const modes = { overlap: copy.paste, insertTracks: copy.pasteInsert, insertAll: copy.pasteSync };

export function TracktionPasteDialog({ trackId, position, onApply, onDismiss }: {
	readonly trackId: string;
	readonly position: number;
	readonly onApply: (edit: TracktionPasteCommand) => void;
	readonly onDismiss: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => { dialog.current?.showModal(); }, []);

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		const fields = new FormData(event.currentTarget);
		onApply({ kind: 'pasteRange', trackId, start: Number(fields.get('start')), mode: fields.get('mode') as TracktionPasteCommand['mode'] });
	}

	return <dialog ref={dialog} aria-label={copy.paste} onCancel={onDismiss}>
		<h2>{copy.paste}</h2>
		<form onSubmit={submit}>
			<p><label>{copy.tracktionStartFrame} <input type="number" name="start" min="0" step="1" defaultValue={position} required /></label></p>
			<p><label>{copy.tracktionPasteMode} <select name="mode" defaultValue="overlap">
				{Object.entries(modes).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
			</select></label></p>
			<button type="submit">{CLIP_INTERACTIONS_COPY_BY_LOCALE.en.apply}</button>{' '}
			<button type="button" onClick={onDismiss}>{PROJECT_COMMAND_COPY_BY_LOCALE.en.cancel}</button>
		</form>
	</dialog>;
}
