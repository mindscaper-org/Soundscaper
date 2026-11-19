/* SPDX-License-Identifier: AGPL-3.0-only */
interface Bounds {
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
}
interface Size { readonly width: number; readonly height: number }

/** Prefer the item's right edge, flipping before clamping to a small viewport. */
export function menuTooltipPosition(anchor: Bounds, content: Size, viewport: Size) {
	const margin = 8;
	const side = anchor.right + margin + content.width <= viewport.width - margin ? 'right' : 'left';
	const proposedLeft = side === 'right' ? anchor.right + margin : anchor.left - content.width - margin;
	return {
		left: Math.max(margin, Math.min(proposedLeft, viewport.width - content.width - margin)),
		top: Math.max(margin, Math.min(anchor.top, viewport.height - content.height - margin)),
		side,
	};
}
