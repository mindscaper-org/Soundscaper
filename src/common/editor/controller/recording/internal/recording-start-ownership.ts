/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingControllerLike,
	RecordingSessionMutableState,
	RecordingStartScope,
} from './recording-session-service.ts';

export type RecordingCaptureOutcome = 'recording' | 'cancelled' | 'handed-off'
	| Readonly<{ kind: 'handed-off'; failure: unknown }>;

export interface OwnedRecordingStartScope extends RecordingStartScope {
	readonly finalization: Promise<void> | null;
	claimRecorder(recorder: RecordingControllerLike): void;
	isHandedOff(recorder: RecordingControllerLike): boolean;
	isCancellation(error: unknown): boolean;
	claimFinalization(finalization: Promise<void>): void;
	cancel(): void;
}

/** Keep transferred capture custody and its exact cancellation identity through cleanup. */
export function createRecordingStartOwnership(
	state: RecordingSessionMutableState,
	getProjectId: () => string | null,
	createAbortError: () => Error,
): OwnedRecordingStartScope {
	const generation = ++state.recordingStartGeneration;
	const projectId = getProjectId();
	const abort = new AbortController();
	let cancellation: Readonly<{ reason: unknown }> | null = null;
	const cancellationReason = () => {
		cancellation ??= { reason: createAbortError() };
		return cancellation.reason;
	};
	let claimedRecorder: RecordingControllerLike | null = null;
	let finalization: Promise<void> | null = null;
	return Object.freeze({
		generation, projectId, signal: abort.signal,
		get finalization() { return finalization; },
		assertCurrent() {
			if (!state.disposed && !abort.signal.aborted && generation === state.recordingStartGeneration && projectId === getProjectId()) return;
			throw cancellationReason();
		},
		claimRecorder(recorder: RecordingControllerLike) { claimedRecorder = recorder; },
		isHandedOff: (recorder: RecordingControllerLike) => claimedRecorder === recorder,
		isCancellation: (error: unknown) => cancellation !== null && error === cancellation.reason,
		claimFinalization(value: Promise<void>) { finalization = value; },
		cancel() { abort.abort(cancellationReason()); },
	});
}

/** A transferred recorder belongs to Stop/finalization, including when its start fails. */
export function recordingCaptureFailure(error: unknown, handedOff: boolean, scope: RecordingStartScope): RecordingCaptureOutcome {
	const aborted = (error as Readonly<{ name?: unknown }> | null | undefined)?.name === 'AbortError';
	if (handedOff) return scope.isCancellation?.(error) ? 'handed-off' : { kind: 'handed-off', failure: error };
	if (aborted) return 'cancelled';
	throw error;
}

/** Abandon only a journal this start acquired and never retry a failed abandonment. */
export async function startOwnedOrdinaryRecording(options: Readonly<{
	begin(): Promise<void>;
	scope: RecordingStartScope;
	capture(): Promise<RecordingCaptureOutcome>;
	abandon(): Promise<void>;
}>): Promise<void> {
	let acquired = false;
	let outcome: RecordingCaptureOutcome | undefined;
	let failure: Readonly<{ reason: unknown }> | null = null;
	try {
		await options.begin();
		acquired = true;
		options.scope.assertCurrent();
		outcome = await options.capture();
	} catch (reason) { failure = { reason }; }
	if (outcome === 'handed-off') return;
	if (typeof outcome === 'object') throw outcome.failure;
	if (acquired && (failure !== null || outcome === 'cancelled')) {
		let cleanupFailure: Readonly<{ reason: unknown }> | null = null;
		try { await options.abandon(); }
		catch (reason) { cleanupFailure = { reason }; }
		if (cleanupFailure !== null) {
			if (failure === null) throw cleanupFailure.reason;
			throw new AggregateError([failure.reason, cleanupFailure.reason], 'Recording start and recovery cleanup both failed.', { cause: failure.reason });
		}
	}
	if (failure !== null) throw failure.reason;
}
