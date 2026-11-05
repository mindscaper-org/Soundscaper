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
