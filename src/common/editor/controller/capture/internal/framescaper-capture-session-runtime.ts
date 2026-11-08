/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CaptureFailure } from '../../../framescaper-capture-domain.ts';
import type { CapturePreviewSource } from '../../../platform/capture-source-port.ts';
import type { FramescaperCaptureInputObserver } from '../framescaper-capture-session-types.ts';

export function installCaptureSourceEndWatchers<Stream, Track>(
	sources: readonly Readonly<CapturePreviewSource<Stream, Track>>[],
	onEnded: (error: Error) => void | PromiseLike<void>,
	observeInput?: FramescaperCaptureInputObserver,
): readonly (() => void)[] {
	return Object.freeze(sources.flatMap(({ track }) => {
		const eventTarget = track as Readonly<{
			readyState?: string; muted?: boolean;
			addEventListener?: (type: string, listener: () => void, options?: unknown) => void;
			removeEventListener?: (type: string, listener: () => void) => void;
		}>;
		if (typeof eventTarget.addEventListener !== 'function') return [];
		if (observeInput) return [observeInput({ tracks: [eventTarget], onInterrupted: onEnded })];
		const report = () => {
			try { globalThis.console?.warn?.('Capture interruption cleanup failed.'); }
			catch { /* Diagnostic observers cannot own capture cleanup. */ }
		};
		const ended = () => {
			try { void Promise.resolve(onEnded(new Error('A required capture source ended.'))).catch(report); }
			catch { report(); }
		};
		eventTarget.addEventListener('ended', ended, { once: true });
		if (eventTarget.readyState === 'ended') ended();
		return [() => eventTarget.removeEventListener?.('ended', ended)];
	}));
}

export function captureSessionFailure(
	error: unknown,
	fallback: CaptureFailure['code'],
): Readonly<CaptureFailure> {
	const name = error && typeof error === 'object' ? (error as { readonly name?: unknown }).name : null;
	const code = name === 'MediaInputLostError' || name === 'RecordingInputLossError' ? 'device-lost' : name === 'NotAllowedError'
		? 'permission-denied'
		: name === 'AbortError' ? 'permission-dismissed'
			: ['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(String(name)) ? 'device-lost' : fallback;
	const message = error instanceof Error ? error.message : String(error || 'Capture failed.');
	return Object.freeze({ code, message: message.slice(0, 1_024) || 'Capture failed.' });
}

export function captureSessionInputGain(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
		throw new RangeError('Capture input gain must be between zero and two.');
	}
	return value;
}

export function safelyStopCaptureClock(clock: Readonly<{ stop(nowMs: number): unknown }>, now: number): void {
	try { clock.stop(now); } catch { /* A concurrent stop already closed the clock. */ }
}

export function waitForCaptureCountdown(durationMs: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(signal.reason);
	if (durationMs <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = globalThis.setTimeout(resolve, durationMs);
		signal.addEventListener('abort', () => {
			globalThis.clearTimeout(timer);
			reject(signal.reason);
		}, { once: true });
	});
}
