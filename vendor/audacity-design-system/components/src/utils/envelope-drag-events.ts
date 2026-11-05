/* SPDX-License-Identifier: AGPL-3.0-only */

/** Retain only the native events belonging to an active envelope drag. */
export function retainEnvelopeDragEvents(
	dragRef: Readonly<{ current: unknown }>,
	finishDrag: () => void,
	cancelDrag: () => void,
): () => void {
	const preventAutoscroll = (event: MouseEvent) => {
		// Windows Chromium otherwise enters native autoscroll and consumes the next menu key.
		if (dragRef.current && event.button === 1 && (event.buttons & 1) !== 0) event.preventDefault();
	};
	const finishOnReleasedPrimary = (event: MouseEvent) => {
		if (dragRef.current && typeof event.buttons === 'number' && (event.buttons & 1) === 0) finishDrag();
	};
	const finishOnBlur = () => { if (dragRef.current) finishDrag(); };
	const cancelOnEscape = (event: KeyboardEvent) => {
		if (event.key !== 'Escape' || !dragRef.current) return;
		event.preventDefault();
		event.stopPropagation();
		cancelDrag();
	};
	document.addEventListener('mousedown', preventAutoscroll, true);
	document.addEventListener('mousemove', finishOnReleasedPrimary, true);
	document.addEventListener('keydown', cancelOnEscape);
	window.addEventListener('blur', finishOnBlur);
	return () => {
		document.removeEventListener('mousedown', preventAutoscroll, true);
		document.removeEventListener('mousemove', finishOnReleasedPrimary, true);
		document.removeEventListener('keydown', cancelOnEscape);
		window.removeEventListener('blur', finishOnBlur);
	};
}
