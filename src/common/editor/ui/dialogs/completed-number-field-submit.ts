/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyboardEvent } from 'react';

/** The surrounding form owns a completed numeric field before the stepper's edit mode. */
export function submitCompletedNumberField(event: KeyboardEvent<HTMLElement>, submit: () => void): void {
	if (event.nativeEvent?.isComposing) { event.stopPropagation(); return; }
	if (event.key !== 'Enter' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
		|| !(event.target instanceof HTMLElement) || event.target.tagName !== 'INPUT') return;
	event.preventDefault();
	event.stopPropagation();
	submit();
}
