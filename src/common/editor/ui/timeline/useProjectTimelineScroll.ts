/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useState, type RefObject } from 'react';
import type { WaveformRulerFormat } from '../../waveform-display-preferences.ts';
import { readTimelineContentScrollX, timelineDomScrollForElement } from './timeline-scroll-space.ts';

type WaveformRulers = Readonly<Record<string, Readonly<{ format?: WaveformRulerFormat; zoom?: number }>>>;
const EMPTY_WAVEFORM_RULERS: WaveformRulers = Object.freeze({});

export type ProjectTimelineViews = Map<string, Readonly<{
	readonly scroll?: Readonly<{ x: number; y: number }>;
	readonly waveformRulers?: WaveformRulers;
}>>;

/** Carry the visible timeline position across remounts of an open project tab. */
export function useProjectTimelineScroll(
	views: ProjectTimelineViews,
	projectId: string | undefined,
	scrollRef: RefObject<HTMLElement | null>,
): void {
	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!projectId || !element) return;
		const saved = views.get(projectId)?.scroll;
		if (saved) {
			element.scrollLeft = timelineDomScrollForElement(element, saved.x);
			element.scrollTop = saved.y;
			element.dispatchEvent(new Event('scroll', { bubbles: true }));
		}
		return () => {
			views.set(projectId, { ...views.get(projectId), scroll: { x: readTimelineContentScrollX(element), y: element.scrollTop } });
		};
	}, [views, projectId, scrollRef]);
}

export function useProjectTimelineWaveformRulers(views: ProjectTimelineViews, projectId: string | undefined) {
	const [waveformRulerState, setWaveformRulerState] = useState<WaveformRulers>(() => (
		projectId ? views.get(projectId)?.waveformRulers ?? EMPTY_WAVEFORM_RULERS : EMPTY_WAVEFORM_RULERS
	));
	useLayoutEffect(() => {
		if (projectId && waveformRulerState !== EMPTY_WAVEFORM_RULERS) {
			views.set(projectId, { ...views.get(projectId), waveformRulers: waveformRulerState });
		}
	}, [views, projectId, waveformRulerState]);
	return { waveformRulerState, setWaveformRulerState };
}
