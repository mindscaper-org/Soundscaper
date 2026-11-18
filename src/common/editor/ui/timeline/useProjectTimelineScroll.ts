/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, type RefObject } from 'react';
import { readTimelineContentScrollX, timelineDomScrollForElement } from './timeline-scroll-space.ts';

export type ProjectTimelineScrollPositions = Map<string, Readonly<{ x: number; y: number }>>;

/** Carry the visible timeline position across remounts of an open project tab. */
export function useProjectTimelineScroll(
	positions: ProjectTimelineScrollPositions,
	projectId: string | undefined,
	scrollRef: RefObject<HTMLElement | null>,
): void {
	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!projectId || !element) return;
		const saved = positions.get(projectId);
		if (saved) {
			element.scrollLeft = timelineDomScrollForElement(element, saved.x);
			element.scrollTop = saved.y;
			element.dispatchEvent(new Event('scroll', { bubbles: true }));
		}
		return () => { positions.set(projectId, { x: readTimelineContentScrollX(element), y: element.scrollTop }); };
	}, [positions, projectId, scrollRef]);
}
