/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { retainEnvelopeDragEvents } from '../utils/envelope-drag-events';

export function useEnvelopeDragLifecycle<Point extends object, Drag>(
	dragRef: RefObject<Drag | null>,
	points: Point[],
	publishPoints: (points: Point[]) => void,
	setHidden: (indices: number[]) => void,
	publishHidden: ((indices: number[]) => void) | undefined,
	publishHovered: ((indices: number[]) => void) | undefined,
	setTooltip: (tooltip: null) => void,
	setDragging: (dragging: boolean) => void,
) {
	const originalPoints = useRef<Point[] | null>(null);
	const rememberBeforeDrag = () => { originalPoints.current = points.slice(); };
	const finishDrag = useCallback(() => {
		setHidden([]);
		publishHidden?.([]);
		publishHovered?.([]);
		setTooltip(null);
		setDragging(false);
		dragRef.current = null;
		originalPoints.current = null;
	}, [dragRef, publishHidden, publishHovered, setDragging, setHidden, setTooltip]);
	useEffect(() => retainEnvelopeDragEvents(dragRef, finishDrag, () => {
		const original = originalPoints.current;
		finishDrag();
		if (original) publishPoints(original);
	}), [dragRef, finishDrag, publishPoints]);
	return { rememberBeforeDrag, finishDrag };
}
