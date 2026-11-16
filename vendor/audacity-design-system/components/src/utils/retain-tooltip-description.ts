/* SPDX-License-Identifier: AGPL-3.0-only */

/** Add a temporary description without discarding other owners' accessible help. */
export function retainTooltipDescription(target: HTMLElement, id: string): () => void {
	const previous = target.getAttribute('aria-describedby');
	target.setAttribute('aria-describedby', [...new Set([...(previous?.split(/\s+/u) ?? []), id])].join(' '));
	return () => {
		const remaining = target.getAttribute('aria-describedby')?.split(/\s+/u).filter(value => value !== id).join(' ');
		if (remaining) target.setAttribute('aria-describedby', remaining);
		else target.removeAttribute('aria-describedby');
	};
}
