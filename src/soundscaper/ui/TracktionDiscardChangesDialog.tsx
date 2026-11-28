/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId } from 'react';

import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import { useTracktionModalDialog } from './useTracktionModalDialog.ts';

export const tracktionDiscardChangesMessage = 'Close the current project and discard unsaved changes?';

export function TracktionDiscardChangesDialog({ onDiscard, onCancel }: {
	readonly onDiscard: () => void;
	readonly onCancel: () => void;
}) {
	const dialog = useTracktionModalDialog();
	const heading = useId();
	function finish(confirmed: boolean): void {
		dialog.current?.close();
		if (confirmed) onDiscard();
		else onCancel();
	}
	return <dialog ref={dialog} aria-labelledby={heading} onCancel={(event) => {
		event.preventDefault();
		finish(false);
	}}>
		<h2 id={heading}>{tracktionDiscardChangesMessage}</h2>
		<button type="button" onClick={() => finish(false)}>{PROJECT_COMMAND_COPY_BY_LOCALE.en.cancel}</button>{' '}
		<button type="button" onClick={() => finish(true)}>Discard changes</button>
	</dialog>;
}
