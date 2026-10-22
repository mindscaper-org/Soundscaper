/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, type RefObject } from 'react';

/** Private DOM bridge for the typed BoundedTextInput vendor adapter. */
export function useNativeNumberBounds(
	container: RefObject<HTMLElement | null>, type: string,
	minimum?: number, maximum?: number, step?: number,
): void {
	useLayoutEffect(() => {
		const input = container.current?.querySelector('input');
		if (!input) return;
		input.min = type === 'number' && minimum !== undefined ? String(minimum) : '';
		input.max = type === 'number' && maximum !== undefined ? String(maximum) : '';
		input.step = type === 'number' && step !== undefined ? String(step) : '';
	}, [container, type, minimum, maximum, step]);
}
