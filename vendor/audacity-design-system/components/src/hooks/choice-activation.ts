/* SPDX-License-Identifier: AGPL-3.0-only */

type ChoiceActivationEvent = Pick<KeyboardEvent,
	'key' | 'defaultPrevented' | 'ctrlKey' | 'metaKey' | 'altKey' | 'preventDefault'>;

/** Consume a plain choice activation while leaving another owner's key alone. */
export function consumeChoiceActivation(event: ChoiceActivationEvent): boolean {
	if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
		|| (event.key !== 'Enter' && event.key !== ' ')) return false;
	event.preventDefault();
	return true;
}

/** The visible label owns clicks outside its separately handled radio control. */
export function activateLabeledChoice(event: { readonly target: EventTarget }, root: ParentNode | null,
	checked: boolean, disabled: boolean, onChange?: (checked: boolean) => void): void {
	if (disabled || (event.target instanceof Element && event.target.closest('[role="radio"]'))) return;
	if (!checked) onChange?.(true);
	root?.querySelector<HTMLElement>('[role="radio"]')?.focus();
}
