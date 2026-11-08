/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep each visible control once, including ordinary native form controls. */
export function rulerFlyoutGroupItems(group: ParentNode): HTMLElement[] {
	return Array.from(group.querySelectorAll<HTMLElement>('button, input, [role="radio"], [role="checkbox"]'))
		.filter(item => !item.hasAttribute('hidden') && item.getAttribute('aria-hidden') !== 'true'
			&& !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true');
}
