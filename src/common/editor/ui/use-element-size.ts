/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useState, type RefCallback } from 'react';

export interface ElementSize {
	readonly width: number;
	readonly height: number;
}

export function retainElementSize(current: ElementSize, width: number, height: number): ElementSize {
	const nextWidth = Math.max(1, Math.round(width));
	const nextHeight = Math.max(1, Math.round(height));
	return current.width === nextWidth && current.height === nextHeight
		? current
		: { width: nextWidth, height: nextHeight };
}

/** Share layout measurement without importing the editor's provider composition. */
export function useElementSize(): readonly [RefCallback<HTMLElement>, ElementSize] {
	const [element, setElement] = useState<HTMLElement | null>(null);
	const [size, setSize] = useState<ElementSize>({ width: 1, height: 1 });
	const ref = useCallback((node: HTMLElement | null) => setElement(node), []);
	useLayoutEffect(() => {
		if (!element) return;
		const update = () => {
			const rect = element.getBoundingClientRect();
			setSize(current => retainElementSize(current, rect.width, rect.height));
		};
		update();
		if (typeof ResizeObserver !== 'function') {
			window.addEventListener('resize', update);
			return () => window.removeEventListener('resize', update);
		}
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return [ref, size];
}
