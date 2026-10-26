/* SPDX-License-Identifier: AGPL-3.0-only */

interface CaptureVideo extends EventTarget {
	currentTime: number;
	readonly seeking?: boolean;
	readonly ownerDocument?: { readonly defaultView: { readonly performance: Pick<Performance, 'now'> } | null };
	requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
	cancelVideoFrameCallback?: (id: number) => void;
}

interface CaptureSeekOptions {
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
	readonly isRequestedFrame?: (mediaTime: number) => boolean;
}

/** A seek and its submitted frame may be delivered in either event order. */
export function seekVideoFrameForCapture(video: CaptureVideo, timestamp: number, options: CaptureSeekOptions): Promise<void> {
	const { signal } = options;
	const aborted = (): DOMException => new DOMException('The operation was aborted.', 'AbortError');
	if (signal?.aborted) return Promise.reject(aborted());
	return new Promise((resolve, reject) => {
		let settled = false;
		let seeked = false;
		let presented = typeof video.requestVideoFrameCallback !== 'function';
		let callbackId: number | undefined;
		const clock = video.ownerDocument?.defaultView?.performance ?? globalThis.performance;
		let seekRequestedAt = Infinity;
		const finish = (error?: Error): void => {
			if (settled || (!error && !(seeked && presented))) return;
			settled = true;
			video.removeEventListener('seeked', onSeeked);
			video.removeEventListener('error', onError);
			signal?.removeEventListener('abort', onAbort);
			if (timeout !== undefined) globalThis.clearTimeout(timeout);
			if (callbackId !== undefined) video.cancelVideoFrameCallback?.(callbackId);
			if (error) reject(error); else resolve();
		};
		const onSeeked = (): void => { seeked = true; finish(); };
		const onError = (): void => { finish(new Error('The browser could not seek this video.')); };
		const onAbort = (): void => { finish(aborted()); };
		const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
			callbackId = undefined;
			// A submission must be fresh in its own window and, while seeking,
			// belong to the requested media frame. Valid pixels may precede seeked.
			if (metadata.presentationTime < seekRequestedAt || (video.seeking && (!Number.isFinite(metadata.mediaTime)
				|| !(options.isRequestedFrame?.(metadata.mediaTime)
					?? Math.abs(metadata.mediaTime - timestamp) <= 0.000001)))) {
				callbackId = video.requestVideoFrameCallback?.(onFrame); return;
			}
			presented = true; finish();
		};
		video.addEventListener('seeked', onSeeked);
		video.addEventListener('error', onError);
		signal?.addEventListener('abort', onAbort, { once: true });
		const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
		const timeout = timeoutMs > 0
			? globalThis.setTimeout(() => { finish(new Error('Timed out waiting for a presented video frame.')); }, timeoutMs)
			: undefined;
		try {
			callbackId = video.requestVideoFrameCallback?.(onFrame);
			seekRequestedAt = clock.now();
			video.currentTime = timestamp;
		} catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
	});
}
