/* SPDX-License-Identifier: AGPL-3.0-only */

interface RenameKeyEvent {
	readonly key: string;
	readonly defaultPrevented?: boolean;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly altKey?: boolean;
	readonly nativeEvent?: { readonly isComposing?: boolean };
	readonly target: EventTarget | null;
	preventDefault(): void;
	stopPropagation(): void;
}

/** The adapter owns its rename editor, including keyboard activation of its name button. */
export function beginTrackNameRename(event: RenameKeyEvent, blocked: boolean, begin: () => void): boolean {
	if (blocked || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
		|| event.nativeEvent?.isComposing || (event.key !== 'Enter' && event.key !== 'F2')) return false;
	if (!(event.target instanceof Element) || !event.target.closest('.track-control-panel__track-name-text')) return false;
	event.preventDefault();
	event.stopPropagation();
	begin();
	return true;
}
