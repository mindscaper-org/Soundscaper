/* SPDX-License-Identifier: AGPL-3.0-only */

interface InputTrack {
	readonly readyState?: string;
	readonly muted?: boolean;
	addEventListener?(type: 'ended' | 'mute' | 'unmute', listener: () => void, options?: AddEventListenerOptions): void;
	removeEventListener?(type: 'ended' | 'mute' | 'unmute', listener: () => void): void;
}

interface InputContext {
	readonly state?: string;
	resume?(): PromiseLike<void> | void;
	addEventListener?(type: 'statechange', listener: () => void): void;
	removeEventListener?(type: 'statechange', listener: () => void): void;
}

interface InterruptionOptions {
	readonly tracks?: readonly InputTrack[];
	readonly context?: InputContext;
	readonly onInterrupted: (error: MediaInputLostError) => void | PromiseLike<void>;
	readonly log?: (message: string) => void;
	readonly muteGraceMs?: number;
	readonly resumeTimeoutMs?: number;
	readonly setTimeout?: (callback: () => void, milliseconds: number) => unknown;
	readonly clearTimeout?: (handle: unknown) => void;
}

/** Input loss preserves valid captured PCM; it is not evidence of corrupt audio. */
export class MediaInputLostError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'MediaInputLostError';
	}
}

/** Recover a live input/context before ending capture, without acquiring replacement devices. */
export function observeMediaInputInterruption(options: InterruptionOptions): () => void {
	const schedule = options.setTimeout ?? ((callback, milliseconds) => globalThis.setTimeout(callback, milliseconds));
	const cancel = options.clearTimeout ?? (handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));
	const removers: Array<() => void> = [];
	const muteDeadlines = new Map<InputTrack, unknown>();
	let resumeDeadline: unknown;
	let resuming = false;
	let resumeGeneration = 0;
	let disposed = false;
	let interrupted = false;
	const log = (message: string) => {
		try { (options.log ?? (value => globalThis.console?.warn?.(value)))(message); }
		catch { /* Diagnostics cannot interrupt recording cleanup. */ }
	};
	const clearDeadlines = () => {
		for (const handle of muteDeadlines.values()) cancel(handle);
		muteDeadlines.clear();
		if (resumeDeadline !== undefined) cancel(resumeDeadline);
		resumeDeadline = undefined;
	};
	const interrupt = (error: MediaInputLostError) => {
		if (disposed || interrupted) return;
		interrupted = true;
		clearDeadlines();
		try {
			void Promise.resolve(options.onInterrupted(error)).catch(() => {
				log('Capture interruption cleanup failed; captured checkpoints remain available.');
			});
		} catch {
			log('Capture interruption cleanup failed; captured checkpoints remain available.');
		}
	};
	for (const track of options.tracks ?? []) {
		const ended = () => interrupt(new MediaInputLostError('The capture input disconnected. Capture stopped to preserve received media.'));
		const muted = () => {
			if (disposed || interrupted || muteDeadlines.has(track)) return;
			log('Capture input temporarily unavailable; waiting for its live track to recover.');
			muteDeadlines.set(track, schedule(() => {
				muteDeadlines.delete(track);
				interrupt(new MediaInputLostError('The capture input did not recover from interruption. Capture stopped to preserve received media.'));
			}, options.muteGraceMs ?? 5_000));
		};
		const unmuted = () => {
			if (disposed || interrupted || !muteDeadlines.has(track)) return;
			cancel(muteDeadlines.get(track)); muteDeadlines.delete(track);
			log('Capture input recovered; capture continues on the same track.');
		};
		for (const [type, listener] of [['ended', ended], ['mute', muted], ['unmute', unmuted]] as const) {
			track.addEventListener?.(type, listener);
			removers.push(() => track.removeEventListener?.(type, listener));
		}
		if (track.readyState === 'ended') ended();
		else if (track.muted) muted();
	}
	const context = options.context;
	const stateChanged = () => {
		if (disposed || interrupted || !context) return;
		if (context.state === 'running' && resuming) {
			if (resumeDeadline !== undefined) cancel(resumeDeadline);
			resumeDeadline = undefined; resuming = false; resumeGeneration += 1;
			log('Capture audio context recovered; capture continues.');
			return;
		}
		if (context.state === 'closed') {
			interrupt(new MediaInputLostError('The capture audio context closed. Capture stopped to preserve received media.'));
			return;
		}
		if (context.state !== 'suspended' && context.state !== 'interrupted' || resuming) return;
		resuming = true;
		const generation = ++resumeGeneration;
		log('Capture audio context temporarily unavailable; attempting automatic recovery.');
		resumeDeadline = schedule(() => {
			if (generation !== resumeGeneration) return;
			resumeDeadline = undefined;
			interrupt(new MediaInputLostError('The capture audio context did not recover in time. Capture stopped to preserve received media.'));
		}, options.resumeTimeoutMs ?? 2_000);
		void Promise.resolve().then(() => { if (!disposed && !interrupted && generation === resumeGeneration) return context.resume?.(); }).then(() => {
			if (disposed || interrupted || generation !== resumeGeneration) return;
			if (resumeDeadline !== undefined) cancel(resumeDeadline);
			resumeDeadline = undefined; resuming = false;
			if (context.state !== 'running') {
				interrupt(new MediaInputLostError('The capture audio context remained unavailable. Capture stopped to preserve received media.'));
			} else log('Capture audio context recovered; capture continues.');
		}, (cause: unknown) => {
			if (generation !== resumeGeneration) return;
			interrupt(new MediaInputLostError('The capture audio context could not resume. Capture stopped to preserve received media.', { cause }));
		});
	};
	context?.addEventListener?.('statechange', stateChanged);
	if (context) removers.push(() => context.removeEventListener?.('statechange', stateChanged));
	stateChanged();
	return () => {
		if (disposed) return;
		disposed = true;
		clearDeadlines();
		for (const remove of removers.splice(0)) remove();
	};
}
