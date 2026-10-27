/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep a private native decoder drawable without adding visible or focusable UI. */
export function mountVideoFrameCaptureElement(video: HTMLVideoElement,
	document: Pick<Document, 'body'> & Partial<Pick<Document, 'documentElement'>>): void {
	const owner = document.body ?? document.documentElement;
	if (!video.style || !owner?.append) return;
	// WebKit culls decoded pixels outside the viewport, even after a frame callback.
	Object.assign(video.style, {
		position: 'fixed', left: '0px', top: '0px', width: '1px', height: '1px',
		pointerEvents: 'none', opacity: '0',
	});
	video.setAttribute('aria-hidden', 'true');
	video.tabIndex = -1;
	owner.append(video);
}

/** Each private resource must retire even when a native teardown method fails. */
export function releaseVideoFrameCaptureElement(
	video: Pick<HTMLVideoElement, 'pause' | 'removeAttribute' | 'load' | 'remove'>,
	revokeOwnedUrl: () => void,
): void {
	for (const release of [
		() => { video.pause?.(); },
		() => { video.removeAttribute?.('src'); },
		() => { video.load?.(); },
		() => { video.remove?.(); },
		revokeOwnedUrl,
	]) {
		try { release(); } catch { /* Continue releasing independent private resources. */ }
	}
}
