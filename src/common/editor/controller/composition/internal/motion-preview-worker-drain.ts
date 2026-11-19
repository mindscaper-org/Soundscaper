/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MotionPreviewWorkerDrain { wait(signal: AbortSignal): Promise<void>; finish(): void }

/** Aborted replacement seeks leave no reactions retained on the cancelled worker's acknowledgement. */
export function createMotionPreviewWorkerDrain(): MotionPreviewWorkerDrain {
	let finished = false; const waiters = new Set<() => void>();
	return {
		wait(signal) {
			signal.throwIfAborted(); if (finished) return Promise.resolve();
			return new Promise((resolve, reject) => {
				const cleanup = () => { waiters.delete(complete); signal.removeEventListener('abort', cancel); };
				const complete = () => { cleanup(); resolve(); };
				const cancel = () => { cleanup(); reject(new DOMException('Motion preview was cancelled.', 'AbortError')); };
				waiters.add(complete); signal.addEventListener('abort', cancel, { once: true });
			});
		},
		finish() { if (!finished) { finished = true; for (const complete of waiters) complete(); waiters.clear(); } },
	};
}
