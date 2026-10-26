/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep the GPU surface in the clip's existing clipping and stacking context. */
export function createWaveformGpuDisplay(owner: HTMLCanvasElement): HTMLCanvasElement | null {
	if (!owner.parentElement) return null;
	const surface = owner.ownerDocument.createElement('canvas');
	surface.className = 'clip-body__waveform-gpu';
	surface.setAttribute('aria-hidden', 'true');
	surface.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;visibility:hidden';
	owner.parentElement.insertBefore(surface, owner);
	return surface;
}
