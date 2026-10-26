/* SPDX-License-Identifier: AGPL-3.0-only */

interface CaptureVideo extends EventTarget {
	currentTime: number;
	readonly seeking?: boolean;
	requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
	cancelVideoFrameCallback?: (id: number) => void;
}

interface CaptureSeekOptions {
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
	readonly isRequestedFrame?: (mediaTime: number) => boolean;
}

/** A seek event may precede submission of the decoded pixels to the compositor. */
export function seekVideoFrameForCapture(video: CaptureVideo, timestamp: number, options: CaptureSeekOptions): Promise<void> {
	const { signal } = options;
	const aborted = (): DOMException => new DOMException('The operation was aborted.', 'AbortError');
	if (signal?.aborted) return Promise.reject(aborted());
	return new Promise((resolve, reject) => {
		let settled = false;
		let seeked = false;
		let presented = typeof video.requestVideoFrameCallback !== 'function';
		let callbackId: number | undefined;
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
			// WebKit can submit the requested pixels before clearing seeking. Keep
			// that frame's timing evidence; older queued frames still need a new callback.
			if (video.seeking && (!Number.isFinite(metadata.mediaTime)
				|| !(options.isRequestedFrame?.(metadata.mediaTime)
					?? Math.abs(metadata.mediaTime - timestamp) <= 0.000001))) {
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
			video.currentTime = timestamp;
		} catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
	});
}
