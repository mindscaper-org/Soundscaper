/* SPDX-License-Identifier: AGPL-3.0-only */

export interface PhotoBrowserDownloadOpportunityScopeCurrentV1 {
	readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelAnimationFrame?: (handle: number) => void;
}
type PresentationDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/** Capture one browser presentation boundary around explicit Photo sidecars.
 * WebKit's asynchronous download navigation policy can discard an earlier
 * anchor request when the next request arrives before that policy is handled.
 * A frame opportunity separates requests; the original save result continues
 * to describe the requested download, without asserting physical acceptance.
 * Hidden documents and unavailable scheduling settle with false immediately.
 * Callers refuse JSON before delivery or preserve a known irreversible result
 * after delivery. Retirement cancels the actual frame and removes listeners.
 *
 * Pinned engine policy: WebKit 343e13bf, WebFrame::invalidatePolicyListeners.
 * https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebKit/WebProcess/WebPage/WebFrame.cpp#L549
 */
export function capturePhotoBrowserDownloadOpportunityCurrentV1(scope: PhotoBrowserDownloadOpportunityScopeCurrentV1,
	value: unknown): ((signal?: AbortSignal) => Promise<boolean>) | null {
	if (typeof scope.requestAnimationFrame !== 'function' || typeof scope.cancelAnimationFrame !== 'function'
		|| value === null || typeof value !== 'object') return null;
	const candidate = value as Partial<PresentationDocument>;
	if (typeof candidate.visibilityState !== 'string' || typeof candidate.addEventListener !== 'function'
		|| typeof candidate.removeEventListener !== 'function') return null;
	const document = candidate as PresentationDocument;
	const requestFrame = scope.requestAnimationFrame.bind(scope), cancelFrame = scope.cancelAnimationFrame.bind(scope);
	const listen = document.addEventListener.bind(document), unlisten = document.removeEventListener.bind(document);
	return signal => {
		if (signal?.aborted) return Promise.resolve(false);
		return new Promise<boolean>(resolve => {
			let finished = false, frame: number | null = null;
			const cancel = () => { if (frame !== null) { const handle = frame; frame = null; try { cancelFrame(handle); } catch { /* Optional presentation became unavailable. */ } } };
			const finish = (available: boolean) => {
				if (finished) return; finished = true; cancel();
				try { unlisten('visibilitychange', visibility); } catch { /* Preserve a known save result. */ }
				try { signal?.removeEventListener('abort', abort); } catch { /* Preserve a known save result. */ }
				resolve(available);
			};
			const abort = () => { finish(false); };
			const schedule = () => {
				if (finished) return;
				try {
					if (document.visibilityState !== 'visible') { finish(false); return; }
					frame ??= requestFrame(() => {
						frame = null;
						try { finish(document.visibilityState === 'visible' && !signal?.aborted); } catch { finish(false); }
					});
				} catch { finish(false); }
			};
			const visibility = () => { schedule(); };
			try {
				listen('visibilitychange', visibility); signal?.addEventListener('abort', abort, { once: true });
				if (signal?.aborted) finish(false); else schedule();
			} catch { finish(false); }
		});
	};
}
