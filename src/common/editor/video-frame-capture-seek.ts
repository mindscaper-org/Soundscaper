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
	readonly retryTimestamp?: number | null;
}
const PRESENTATION_RETRY_DELAY_MS = 75;

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
		let retryTimestamp = options.retryTimestamp;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const finish = (error?: Error): void => {
			if (settled || (!error && !(seeked && presented))) return;
			settled = true;
			video.removeEventListener('seeked', onSeeked);
			video.removeEventListener('error', onError);
			signal?.removeEventListener('abort', onAbort);
			if (timeout !== undefined) globalThis.clearTimeout(timeout);
			if (retryTimer !== undefined) globalThis.clearTimeout(retryTimer);
			if (callbackId !== undefined) video.cancelVideoFrameCallback?.(callbackId);
			if (error) reject(error); else resolve();
		};
		const onSeeked = (): void => {
			seeked = true;
			finish();
			// A drained paused seek may never submit another callback after a rejected early one.
			if (!settled && retryTimestamp != null && retryTimer === undefined) {
				retryTimer = globalThis.setTimeout(retry, PRESENTATION_RETRY_DELAY_MS);
			}
		};
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
		const issueSeek = (target: number): void => {
			try {
				callbackId = video.requestVideoFrameCallback?.(onFrame);
				video.currentTime = target;
			} catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
		};
		const retry = (): void => {
			retryTimer = undefined;
			const target = retryTimestamp;
			retryTimestamp = undefined;
			if (settled || presented || target == null) return;
			seeked = false;
			if (callbackId !== undefined) video.cancelVideoFrameCallback?.(callbackId);
			issueSeek(target);
		};
		video.addEventListener('seeked', onSeeked);
		video.addEventListener('error', onError);
		signal?.addEventListener('abort', onAbort, { once: true });
		const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
		const timeout = timeoutMs > 0
			? globalThis.setTimeout(() => { finish(new Error('Timed out waiting for a presented video frame.')); }, timeoutMs)
			: undefined;
		issueSeek(timestamp);
	});
}
