/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useRef } from 'react';

function closeOpenMenus(nav: HTMLElement | null, restoreFocus: boolean): boolean {
	const open = nav?.querySelectorAll<HTMLDetailsElement>('details[open]');
	if (!open?.length) return false;
	for (const menu of open) {
		const summary = menu.querySelector('summary');
		const focused = menu.ownerDocument.activeElement;
		if (restoreFocus && focused !== summary && menu.contains(focused)) summary?.focus({ preventScroll: true });
		menu.open = false;
	}
	return true;
}

export function useTracktionMenus() {
	const menuBar = useRef<HTMLElement>(null);
	const menuGroup = useId();
	useEffect(() => {
		const nav = menuBar.current;
		if (!nav) return;
		const document = nav.ownerDocument;
		const onClick = (event: MouseEvent): void => {
			// The narrow layout can move the clicked control when the menu closes.
			if (!event.composedPath().includes(nav)) closeOpenMenus(nav, false);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented && closeOpenMenus(nav, true)) {
				event.preventDefault();
			}
		};
		document.addEventListener('click', onClick, true);
		nav.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('click', onClick, true);
			nav.removeEventListener('keydown', onKeyDown);
		};
	}, []);
	return {
		menuBar,
		menuGroup,
		closeMenus() { closeOpenMenus(menuBar.current, true); },
	};
}
