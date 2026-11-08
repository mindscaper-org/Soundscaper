/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface Props {
	readonly kind: 'replacement' | 'relink';
	readonly title: string;
	readonly message: string;
	readonly cancelLabel: string;
	readonly onCancel: () => void;
	readonly actions: readonly Readonly<{ label: string; disabled: boolean; variant?: 'primary' | 'secondary'; onClick: () => void }>[];
}

/** Existing staged-media choices share the editor's modal keyboard ownership. */
export default function ProjectBinMediaChoiceDialog({ kind, title, message, cancelLabel, onCancel, actions }: Props) {
	const descriptionId = useId();
	const attributes = kind === 'replacement'
		? { 'data-project-bin-replacement-dialog': true }
		: { 'data-project-bin-relink-changed-dialog': true };
	return <AudioEditorDialogShell role="alertdialog" title={title} width={480}
		className="kw-audio-editor__project-bin-confirm" onClose={onCancel}
		initialFocus="[data-project-bin-choice-actions] button" overlayDataAttributes={attributes} ariaDescribedBy={descriptionId}>
		<p id={descriptionId}>{message}</p>
		<div className="kw-audio-editor-dialog__actions" data-project-bin-choice-actions>
			<Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
			{actions.map(action => <Button key={action.label} variant={action.variant ?? 'primary'} disabled={action.disabled}
				onClick={action.onClick}>{action.label}</Button>)}
		</div>
	</AudioEditorDialogShell>;
}
