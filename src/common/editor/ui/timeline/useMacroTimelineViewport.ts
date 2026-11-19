/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, type RefObject } from 'react';
import type { createEffectMacroActions } from '../../controller/effects/effect-library-action-groups.ts';
import { readTimelineContentScrollX, timelineDomScrollForElement } from './timeline-scroll-space.ts';

type MacroActions = Pick<ReturnType<typeof createEffectMacroActions>, 'bindViewport'>;

/** Bind only timeline scrolling; programs receive plain coordinates, never DOM capabilities. */
export function useMacroTimelineViewport(
	controller: { readonly actions: { readonly macros: MacroActions } },
	projectId: string | undefined,
	scrollRef: RefObject<HTMLElement | null>,
): void {
	useLayoutEffect(() => {
		if (!projectId) return;
		let active = true;
		const pending = new Set<{ frame: number; reject: (error: unknown) => void }>();
		const unbind = controller.actions.macros.bindViewport({
			read: () => ({ scrollX: readTimelineContentScrollX(scrollRef.current), scrollY: scrollRef.current?.scrollTop ?? 0 }),
			write: (position, assertCurrent) => new Promise<void>((resolve, reject) => {
				const task = { frame: 0, reject };
				pending.add(task);
				// Zoom and track changes publish through React before their scroll geometry exists.
				task.frame = requestAnimationFrame(() => {
					task.frame = requestAnimationFrame(() => {
						pending.delete(task);
						try {
							assertCurrent();
							const element = scrollRef.current;
							if (!active || !element) throw new DOMException('The timeline viewport changed.', 'AbortError');
							element.scrollLeft = timelineDomScrollForElement(element, position.scrollX);
							element.scrollTop = position.scrollY;
							element.dispatchEvent(new Event('scroll', { bubbles: true }));
							resolve();
						} catch (error) { reject(error); }
					});
				});
			}),
		});
		return () => {
			active = false;
			unbind();
			for (const task of pending) {
				cancelAnimationFrame(task.frame);
				task.reject(new DOMException('The timeline viewport changed.', 'AbortError'));
			}
			pending.clear();
		};
	}, [controller, projectId, scrollRef]);
}
