/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type RefObject } from 'react';

/** Existing browser workspace events remain separate from desktop ownership. */
export function useLightscaperWorkspaceEvents(options: {
	readonly app: RefObject<HTMLElement | null>;
	readonly name: string;
	readonly isCurrent: () => boolean;
	readonly show: () => void;
	readonly readPage: () => Promise<unknown>;
}): void {
	const { app, name, isCurrent, show, readPage } = options;
	const showCurrent = useRef(show); showCurrent.current = show;
	useEffect(() => {
		const dismiss = (event: PointerEvent) => {
			for (const menu of app.current?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? []) {
				if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
			}
		};
		document.addEventListener('pointerdown', dismiss);
		return () => { document.removeEventListener('pointerdown', dismiss); };
	}, [app]);
	useEffect(() => {
		const publish = () => window.dispatchEvent(new CustomEvent('scape:workspace-state', {
			detail: { productId: 'lightscaper', activeId: 'photo-library', workspaces: [{ id: 'photo-library', name }] },
		}));
		const request = (event: Event) => {
			if (!isCurrent()) return;
			const detail: unknown = (event as CustomEvent<unknown>).detail;
			if (!detail || typeof detail !== 'object') return;
			if (Reflect.get(detail, 'productId') === 'lightscaper' && Reflect.get(detail, 'workspaceId') === 'photo-library') {
				showCurrent.current(); void readPage();
			}
		};
		publish();
		window.addEventListener('scape:workspace-ready', publish);
		window.addEventListener('scape:workspace-request', request);
		return () => {
			window.removeEventListener('scape:workspace-ready', publish);
			window.removeEventListener('scape:workspace-request', request);
		};
	}, [name, isCurrent, readPage]);
}
