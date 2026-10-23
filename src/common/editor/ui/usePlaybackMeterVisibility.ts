/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, type RefObject } from 'react';
import { acquirePlaybackMeterDemand, activatePlaybackMeterDemand } from '../engine/playback-meter-demand.ts';
import type { StripRef } from '../parameter-address.ts';

interface ObservedTarget {
	readonly listeners: Set<(visible: boolean) => void>;
	visible: boolean;
}

const targets = new Map<Element, ObservedTarget>();
let observer: IntersectionObserver | null = null;

/** One browser observer shares visibility across timeline headers and mixer bars. */
export function observePlaybackMeterVisibility(owner: object, strip: StripRef, element: Element): () => void {
	activatePlaybackMeterDemand(owner);
	let release: (() => void) | undefined;
	let disposed = false;
	const update = (visible: boolean): void => {
		if (disposed) return;
		if (visible) release ??= acquirePlaybackMeterDemand(owner, strip);
		else { release?.(); release = undefined; }
	};
	if (typeof IntersectionObserver !== 'function') {
		update(true);
		return () => { disposed = true; release?.(); };
	}
	observer ??= new IntersectionObserver(entries => {
		for (const entry of entries) {
			const target = targets.get(entry.target);
			if (!target) continue;
			target.visible = entry.isIntersecting && entry.intersectionRatio > 0;
			for (const listener of target.listeners) listener(target.visible);
		}
	});
	let target = targets.get(element);
	if (!target) {
		target = { listeners: new Set(), visible: false };
		targets.set(element, target);
		observer.observe(element);
	}
	const { listeners } = target;
	listeners.add(update);
	update(target.visible);
	return () => {
		if (disposed) return;
		disposed = true;
		release?.();
		listeners.delete(update);
		if (!listeners.size) { targets.delete(element); observer?.unobserve(element); }
		if (!targets.size) { observer?.disconnect(); observer = null; }
	};
}

export function usePlaybackMeterVisibility(
	owner: object | undefined, scope: 'track' | 'master' | 'group' | 'send', id: string,
	element: RefObject<Element | null>,
): void {
	useEffect(() => {
		if (!owner || !element.current) return;
		const strip: StripRef = scope === 'master' ? { kind: 'master' }
			: { kind: scope === 'track' ? 'track' : 'mixer-node', id };
		return observePlaybackMeterVisibility(owner, strip, element.current);
	}, [owner, scope, id, element]);
}
