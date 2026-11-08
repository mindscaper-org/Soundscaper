/* SPDX-License-Identifier: AGPL-3.0-only */

export interface VideoPreviewMediaSeekSource {
	currentTime: number;
	readonly seeking?: boolean;
	readonly src?: string;
	readonly currentSrc?: string;
	readonly srcObject?: unknown;
	addEventListener?(type: string, listener: EventListener): void;
	removeEventListener?(type: string, listener: EventListener): void;
}

interface PendingSeek {
	readonly src: string | undefined;
	readonly currentSrc: string | undefined;
	readonly srcObject: unknown;
	targetSeconds: number;
	tolerance: number;
	cancel(): void;
}

const PENDING_SEEKS = new WeakMap<object, PendingSeek>();
const CANCELLING_EVENTS = ['loadstart', 'emptied', 'error', 'abort'] as const;

/** Retain only the latest preview target while the browser finishes its current decode. */
export function seekVideoPreviewMedia(
	source: VideoPreviewMediaSeekSource,
	targetSeconds: number,
	tolerance: number,
): void {
	const pending = PENDING_SEEKS.get(source);
	if (pending && !sameSource(source, pending)) pending.cancel();
	if (Math.abs((Number(source.currentTime) || 0) - targetSeconds) <= tolerance) {
		cancelVideoPreviewMediaSeek(source);
		return;
	}
	if (source.seeking !== true || typeof source.addEventListener !== 'function'
		|| typeof source.removeEventListener !== 'function') {
		cancelVideoPreviewMediaSeek(source);
		source.currentTime = targetSeconds;
		return;
	}
	const current = PENDING_SEEKS.get(source);
	if (current) {
		current.targetSeconds = targetSeconds;
		current.tolerance = tolerance;
		return;
	}
	queueSeek(source, targetSeconds, tolerance);
}

/** Retiring a preview element must also retire its deferred seek listeners. */
export function cancelVideoPreviewMediaSeek(source: object | null | undefined): void {
	if (source) PENDING_SEEKS.get(source)?.cancel();
}

/** Decoder readiness alone can still refer to a superseded scrub target. */
export function hasPendingVideoPreviewMediaSeek(source: object): boolean {
	return PENDING_SEEKS.has(source);
}

function queueSeek(source: VideoPreviewMediaSeekSource, targetSeconds: number, tolerance: number): void {
	const addListener = source.addEventListener!.bind(source);
	const removeListener = source.removeEventListener!.bind(source);
	const queued: PendingSeek = {
		src: source.src, currentSrc: source.currentSrc, srcObject: source.srcObject,
		targetSeconds, tolerance,
		cancel: () => {
			if (PENDING_SEEKS.get(source) !== queued) return;
			PENDING_SEEKS.delete(source);
			removeListener('seeked', drain);
			for (const event of CANCELLING_EVENTS) removeListener(event, cancel);
		},
	};
	const cancel = (): void => { queued.cancel(); };
	const drain = (): void => {
		if (source.seeking === true || PENDING_SEEKS.get(source) !== queued) return;
		queued.cancel();
		if (!sameSource(source, queued)) return;
		try {
			seekVideoPreviewMedia(source, queued.targetSeconds, queued.tolerance);
		} catch { /* Media readiness callbacks retry a target rejected during loading. */ }
	};
	PENDING_SEEKS.set(source, queued);
	try {
		addListener('seeked', drain);
		for (const event of CANCELLING_EVENTS) addListener(event, cancel);
	} catch (error) {
		queued.cancel();
		throw error;
	}
}

function sameSource(source: VideoPreviewMediaSeekSource, queued: PendingSeek): boolean {
	return source.src === queued.src && source.currentSrc === queued.currentSrc
		&& source.srcObject === queued.srcObject;
}
