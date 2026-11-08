/* SPDX-License-Identifier: AGPL-3.0-only */

/** A trusted recorder input-presence failure, distinct from PCM/storage corruption. */
export class RecordingInputLossError extends Error {
	readonly code = 'RECORDING_INPUT_LOST';
	constructor() {
		super('The recording input stopped delivering audio channels and did not recover.');
		this.name = 'RecordingInputLossError';
	}
}

/** Translate worklet lifecycle messages without importing controller coordination. */
export function handleRecordingInputEvent(
	message: unknown,
	onLost: (error: RecordingInputLossError) => void,
	log: (message: string) => void = value => globalThis.console?.warn?.(value),
): boolean {
	if (!message || typeof message !== 'object' || !('type' in message)) return false;
	if (message.type === 'input-lost') {
		try { onLost(new RecordingInputLossError()); }
		catch { /* A failed observer cannot escape the recording message event. */ }
		return true;
	}
	if (message.type !== 'input-status' || !('available' in message) || typeof message.available !== 'boolean') return false;
	try { log(message.available ? 'Recording input delivery recovered; capture continues.' : 'Recording input delivery temporarily unavailable; waiting for recovery.'); }
	catch { /* Diagnostics cannot own capture. */ }
	return true;
}

export function normalizeRecordingTimeout(value: unknown, phase: 'start' | 'stop'): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1 || number > 60_000) {
		throw new RangeError(`Recording ${phase}TimeoutMs must be between 1 and 60000 milliseconds.`);
	}
	return number;
}

interface ResumeConfirmationPorts<Timer> {
	readonly sampleRate: number;
	readonly timeoutMs: number;
	postMessage(message: Readonly<Record<string, unknown>>): void;
	assertPaused(scheduled: boolean): void;
	onScheduled(): void;
	fail(error: Error): void;
	setTimeout?(callback: () => void, milliseconds: number): Timer;
	clearTimeout?(timer: Timer): void;
}

/** Confirm a paused input's future source frame without resetting its recorded prefix. */
export function createRecordingResumeConfirmation<Timer>(ports: ResumeConfirmationPorts<Timer>) {
	let sequence = 0, scheduledFrame: number | null = null, confirmedMode = false;
	let pending: { id: number; frame: number; attempts: number; timer?: Timer;
		resolve(value: Readonly<{ startFrame: number }>): void; reject(error: unknown): void } | null = null;
	function cancel(error: unknown = new DOMException('Recording resume cancelled.', 'AbortError')): void {
		const request = pending;
		pending = null; scheduledFrame = null;
		if (request?.timer !== undefined) ports.clearTimeout?.(request.timer);
		request?.reject(error);
	}
	function send(): void {
		if (pending) ports.postMessage({ type: 'resume', confirmResume: true, requestId: pending.id, startFrame: pending.frame });
	}
	return Object.freeze({
		cancel,
		reset() { cancel(); confirmedMode = false; },
		resume({ startFrame }: Readonly<{ startFrame: number }>): Promise<Readonly<{ startFrame: number }>> {
			try {
				ports.assertPaused(scheduledFrame !== null);
				if (!Number.isSafeInteger(startFrame) || startFrame < 0) throw new RangeError('Confirmed recording resume requires a non-negative safe startFrame.');
				cancel(); confirmedMode = true;
				const promise = new Promise<Readonly<{ startFrame: number }>>((resolve, reject) => {
					pending = { id: ++sequence, frame: startFrame, attempts: 0, resolve, reject };
					const request = pending;
					request.timer = ports.setTimeout?.(() => {
						if (pending !== request) return;
						const error = Object.assign(new Error(`The recording worklet did not acknowledge its resume within ${ports.timeoutMs} milliseconds.`),
							{ name: 'TimeoutError', code: 'RECORDING_RESUME_TIMEOUT' });
						cancel(error); ports.fail(error);
					}, ports.timeoutMs);
				});
				try { send(); } catch (error) { cancel(error); }
				return promise;
			} catch (error) { return Promise.reject(error); }
		},
		handle(message: Readonly<Record<string, unknown>>): boolean {
			if (message.type === 'resumed' && confirmedMode) {
				if (message.frame === scheduledFrame) { scheduledFrame = null; ports.onScheduled(); }
				return true;
			}
			if (!['resume-scheduled', 'resume-missed', 'resume-rejected'].includes(String(message.type))) return false;
			const request = pending;
			if (!request || message.requestId !== request.id) return true;
			if (message.type === 'resume-missed' && Number.isSafeInteger(message.firstAvailableFrame)
				&& Number(message.firstAvailableFrame) >= 0 && request.attempts < 4) {
				request.frame = Number(message.firstAvailableFrame) + Math.ceil(Math.max(128, ports.sampleRate / 4)) * 2 ** request.attempts++;
				if (Number.isSafeInteger(request.frame)) {
					try { send(); } catch (error) { cancel(error); }
					return true;
				}
			}
			if (message.type !== 'resume-scheduled' || message.startFrame !== request.frame) {
				const error = new Error('The recording input could not confirm a future resume frame.');
				cancel(error); ports.fail(error); return true;
			}
			pending = null; scheduledFrame = request.frame;
			if (request.timer !== undefined) ports.clearTimeout?.(request.timer);
			ports.onScheduled(); request.resolve({ startFrame: request.frame });
			return true;
		},
	});
}
