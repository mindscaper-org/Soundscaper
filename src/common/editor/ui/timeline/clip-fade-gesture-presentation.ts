/* SPDX-License-Identifier: AGPL-3.0-only */

export interface CapturedClipFadeGesture {
	readonly pointerId: number;
	readonly target: HTMLElement;
	readonly clipId: string;
	readonly edge: 'in' | 'out';
	readonly shape: boolean;
}

type Present = (gesture: CapturedClipFadeGesture) => void;
const OWNERS = new WeakMap<HTMLElement, Present>();

/** Mounted fade overlays register callbacks without idle event listeners. */
export function registerClipFadeGesturePresentation(owner: HTMLElement, present: Present): () => void {
	OWNERS.set(owner, present);
	return () => { if (OWNERS.get(owner) === present) OWNERS.delete(owner); };
}

/** The native gesture owner calls this only after admission and pointer capture. */
export function presentCapturedClipFadeGesture(owner: HTMLElement | null, gesture: CapturedClipFadeGesture): boolean {
	if (!owner || !owner.contains(gesture.target) || !gesture.target.hasPointerCapture?.(gesture.pointerId)) return false;
	const present = OWNERS.get(owner);
	if (!present) return false;
	present(gesture);
	return true;
}
