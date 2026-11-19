/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingSessionServiceRuntime, RecordingStartOptions, RecordingStartScope } from './recording-session-service.ts';
import { createRecordingStartOwnership, type OwnedRecordingStartScope } from './recording-start-ownership.ts';

type MaybePromise<Value> = Value | PromiseLike<Value>;
function invokeAsPromise<Value>(operation: () => MaybePromise<Value>): Promise<Value> {
	try { return Promise.resolve(operation()); } catch (error) { return Promise.reject(error); }
}

/** Own one start intent while permission staging and prior MIDI publication settle. */
export function createRecordingStartRequests(runtime: RecordingSessionServiceRuntime, stopping: () => boolean = () => false) {
	const { state } = runtime;
	const publishDocumentSnapshot = runtime.publishDocumentSnapshot ?? (() => {});
	const releaseInputs = runtime.releaseUnretainedRecordingInputs ?? (() => {});
	let activeScope: OwnedRecordingStartScope | null = null;
	let retiring: Promise<void> | null = null;
	return Object.freeze({ startRecording, startSoundActivatedRecording, startRecordingOnNewTrack, startTakeCycleRecording, cancelRecordingStart,
		get scope() { return activeScope; }, clearScope() { activeScope = null; } });

	function startBlocked(): boolean {
		return state.readOnly
			|| Boolean(state.takeCycleRecovery)
			|| state.takeCycleRecoveryInspecting === true
			|| state.recordingStarting
			|| Boolean(state.recordingStartPromise)
			|| stopping()
			|| Boolean(state.recorder);
	}

	function isTimedStart(options: RecordingStartOptions): boolean {
		return Number.isFinite(Number(options.timedStartTimeMs))
			&& state.timedRecording?.generation === options.timedGeneration;
	}

	function createStartScope(): RecordingStartScope {
		activeScope = createRecordingStartOwnership(state, runtime.getProjectId,
			runtime.abortError ?? (() => new DOMException('The recording start was superseded.', 'AbortError')));
		return activeScope;
	}

	function startRecording(options: RecordingStartOptions = {}) { return startRecordingSession(options, false); }
	function startRecordingSession(options: RecordingStartOptions, soundActivated: boolean,
		prepare = (value: RecordingStartOptions): RecordingStartOptions | null => runtime.prepareRecordingOptions?.(value) ?? value,
		mode: 'ordinary' | 'new-track' = 'ordinary'): Promise<void> | undefined {
		if (soundActivated && runtime.canStartSoundActivatedRecording?.() === false) return undefined;
		const timedStart = isTimedStart(options);
		if (startBlocked() || (!timedStart && (state.timedRecordingPreparing || state.timedRecording))) {
			return undefined;
		}
		if (state.projectBinPreview) void runtime.stopProjectBinPreview?.();
		runtime.setSoundActivationCaptureEnabled?.(soundActivated);
		const scope = createStartScope();
		state.recordingKind = soundActivated ? 'sound-activated' : 'ordinary';
		const begin = (value: RecordingStartOptions) => { scope.assertCurrent(); const prepared = prepare(value); return prepared ? runtime.beginRecording(prepared, scope) : undefined; };
		const operation = invokeAsPromise(() => {
			const previous = retiring;
			const staging = runtime.prepareRecordingStart?.(options, scope, mode, previous ?? undefined);
			if (!staging && !previous) return begin(options);
			state.recordingAdmissionPending = true;
			return Promise.all([previous, staging]).then(([, prepared]) => begin(prepared ?? options));
		}).then(outcome => {
			if (typeof outcome === 'object' && outcome !== null && outcome.kind === 'handed-off') throw outcome.failure;
		});
		const tracked = operation.finally(() => {
			if (state.recordingStartPromise === tracked) {
				state.recordingStartPromise = null;
				state.recordingAdmissionPending = false;
				if (!state.recorder) { activeScope = null; state.recordingKind = null; runtime.setSoundActivationCaptureEnabled?.(false); }
				publishDocumentSnapshot();
			}
		});
		state.recordingStartPromise = tracked;
		if (state.recordingAdmissionPending) publishDocumentSnapshot();
		return tracked;
	}
	function startSoundActivatedRecording(options: RecordingStartOptions = {}) { return startRecordingSession(options, true); }

	function startTakeCycleRecording(): Promise<void> | undefined {
		if (!runtime.beginTakeCycleRecording || startBlocked()
			|| state.timedRecordingPreparing || state.timedRecording) return undefined;
		if (state.projectBinPreview) void runtime.stopProjectBinPreview?.();
		const scope = createStartScope();
		state.recordingKind = 'take-cycle';
		const operation = invokeAsPromise(async () => {
			const previous = retiring;
			const staging = runtime.prepareRecordingStart?.({}, scope, 'take-cycle', previous ?? undefined);
			let preparedScope = scope;
			if (staging || previous) {
				state.recordingAdmissionPending = true;
				const [, prepared] = await Promise.all([previous, staging]);
				scope.assertCurrent();
				preparedScope = { ...scope, reusePreparedInputsOnly: prepared?.reusePreparedInputsOnly };
			}
			state.recordingStarting = true;
			const recorder = await runtime.beginTakeCycleRecording!(preparedScope);
			scope.assertCurrent();
			state.recorder = recorder;
		});
		const tracked = operation.finally(() => {
			if (state.recordingStartPromise === tracked) {
				state.recordingStartPromise = null;
				state.recordingAdmissionPending = false;
				state.recordingStarting = false;
				if (!state.recorder) { activeScope = null; state.recordingKind = null; }
				publishDocumentSnapshot();
			}
		});
		state.recordingStartPromise = tracked;
		if (state.recordingAdmissionPending) publishDocumentSnapshot();
		return tracked;
	}

	async function startRecordingOnNewTrack(options: RecordingStartOptions = {}): Promise<string | null> {
		if (startBlocked() || state.timedRecordingPreparing || state.timedRecording) return null;
		let trackId: string | null = null;
		await startRecordingSession(options, false, value => {
			trackId = runtime.addTrack?.({ armed: true }) || null;
			return trackId ? { ...value, trackId } : null;
		}, 'new-track');
		return trackId;
	}

	function cancelRecordingStart(): boolean {
		if (!state.recordingStarting && !state.recordingStartPromise) return false;
		const canceled = state.recordingStartPromise;
		state.recordingStartGeneration += 1;
		state.recordingStarting = false;
		state.recordingAdmissionPending = false;
		activeScope?.cancel();
		if (!state.recorder && canceled) {
			const retirement = Promise.allSettled([retiring, canceled]).then(() => undefined);
			retiring = retirement;
			void retirement.then(() => { if (retiring === retirement) retiring = null; });
			state.recordingStartPromise = null;
			state.recordingKind = null;
			runtime.setSoundActivationCaptureEnabled?.(false);
		}
		runtime.resetSoundActivationSources?.();
		if (!state.recorder) releaseInputs();
		return true;
	}
}
