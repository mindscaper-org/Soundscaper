/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingSessionMutableState } from './recording-session-service.ts';
import type { OwnedRecordingStartScope } from './recording-start-ownership.ts';

type Settlement = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: unknown }>;

function settle(operation: () => unknown): Promise<Settlement> {
	try {
		return Promise.resolve(operation()).then<Settlement, Settlement>(
			() => ({ ok: true }),
			(reason: unknown) => ({ ok: false, reason }),
		);
	} catch (reason) { return Promise.resolve({ ok: false, reason }); }
}

/** Stop the recorder before joining its pending acknowledgement, then settle its journal. */
export async function stopOwnedRecording(options: Readonly<{
	state: RecordingSessionMutableState;
	scope: OwnedRecordingStartScope | null;
	cancelStart(): boolean;
	publish(): void;
	finalize(): Promise<void>;
}>): Promise<void> {
	const { state, scope } = options;
	const start = state.recordingStartPromise;
	const recorder = state.recorder;
	const finalization = state.recordingFinalizePromise ?? scope?.finalization;
	const starting = state.recordingStarting || start !== null;
	if (recorder) scope?.claimRecorder(recorder);
	const joinedStart = start ? settle(() => start) : null;
	let admissionFailure: Readonly<{ reason: unknown }> | null = null;
	try { if (starting) { options.cancelStart(); options.publish(); } }
	catch (reason) { admissionFailure = { reason }; }
	const stopped = recorder && !finalization && state.recordingKind !== 'take-cycle'
		? settle(() => recorder.stop()) : null;
	const stopResult = stopped ? await stopped : null;
	const startResult = joinedStart ? await joinedStart : null;
	const finishResult = await settle(() => finalization ?? scope?.finalization
		?? state.recordingFinalizePromise ?? options.finalize());
	const failures: unknown[] = [];
	if (stopResult && !stopResult.ok) failures.push(stopResult.reason);
	if (admissionFailure) failures.push(admissionFailure.reason);
	if (startResult && !startResult.ok && !scope?.isCancellation(startResult.reason)) failures.push(startResult.reason);
	if (!finishResult.ok) failures.push(finishResult.reason);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Recording stop and finalization both failed.', { cause: failures[0] });
}
