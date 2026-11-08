interface FaderTrackBounds { readonly top: number; readonly height: number }

/** A handle grab retains its physical offset; exposed track clicks stay absolute. */
export function mixerFaderGrabOffsetY(clientY: number, bounds: FaderTrackBounds,
	value: number, minimum: number, maximum: number, handleHeight: number): number {
	const centerY = bounds.top + (1 - (value - minimum) / (maximum - minimum)) * bounds.height;
	const offset = clientY - centerY;
	return Math.abs(offset) <= handleHeight / 2 ? offset : 0;
}

export function mixerFaderValueFromY(clientY: number, bounds: FaderTrackBounds,
	minimum: number, maximum: number, offset: number, fallback: number): number {
	if (bounds.height === 0) return fallback;
	const y = Math.max(0, Math.min(bounds.height, clientY - bounds.top - offset));
	return minimum + (1 - y / bounds.height) * (maximum - minimum);
}
