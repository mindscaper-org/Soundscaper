/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';

import { CLIP_INTERACTIONS_COPY_BY_LOCALE } from '../../common/i18n/editor-clip-interactions-copy.ts';
import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import { TRACK_COPY_BY_LOCALE } from '../../common/i18n/track-copy.js';
import type { TracktionTrackMix } from '../tracktion-project-contract.ts';
import { TracktionEditForm } from './TracktionEditForm.tsx';
import { useTracktionModalDialog } from './useTracktionModalDialog.ts';

const copy = TRACK_COPY_BY_LOCALE.en;

export function TracktionMixerDialog({ track, mix, onApply, onDismiss }: {
	readonly track: string;
	readonly mix: TracktionTrackMix;
	readonly onApply: (mix: TracktionTrackMix) => void;
	readonly onDismiss: () => void;
}) {
	const dialog = useTracktionModalDialog();
	const gainEdited = useRef(false);

	function apply(fields: FormData): void {
		onApply({ gainDb: gainEdited.current ? Number(fields.get('gainDb')) : mix.gainDb, pan: Number(fields.get('pan')),
			muted: fields.has('muted'), solo: fields.has('solo') });
	}

	return <dialog ref={dialog} aria-label={copy.mixer} onCancel={onDismiss}>
		<h2>{copy.mixer}</h2>
		<TracktionEditForm onApply={apply}>
			<fieldset>
				<legend>{track}</legend>
				<p><label>{copy.gain} <input name="gainDb" type="number" required min="-100" max="6" step="any"
					defaultValue={Math.round(mix.gainDb * 1000) / 1000} onInput={() => { gainEdited.current = true; }} /> dB</label></p>
				<p><label>{copy.pan} <input name="pan" type="number" required min="-1" max="1" step="any" defaultValue={mix.pan} /></label></p>
				<p><label><input name="muted" type="checkbox" defaultChecked={mix.muted} /> {copy.mute}</label>{' '}
					<label><input name="solo" type="checkbox" defaultChecked={mix.solo} /> {copy.solo}</label></p>
			</fieldset>
			<button type="submit">{CLIP_INTERACTIONS_COPY_BY_LOCALE.en.apply}</button>{' '}
			<button type="button" onClick={onDismiss}>{PROJECT_COMMAND_COPY_BY_LOCALE.en.cancel}</button>
		</TracktionEditForm>
	</dialog>;
}
