/* SPDX-License-Identifier: AGPL-3.0-only */

import { createRecordingStartRequests } from './recording-start-requests.ts';
import { transitionRoutedRecordingSources } from './routed-recording-transition.ts';
import type { RecordingCaptureOutcome } from './recording-start-ownership.ts';
import { stopOwnedRecording } from './recording-stop-operation.ts';
import { confirmRoutedRecordingResume, confirmRoutedRecordingStart } from './confirmed-recording-sources.ts';
import { recordingResumeTiming } from './recording-start-timing.ts';
import { raceAbortableRead } from '../../../../foundation/abort-race.ts';

type MaybePromise<T> = T | PromiseLike<T>;

function invokeAsPromise<T>(operation: () => MaybePromise<T>): Promise<T> {
	try {
		return Promise.resolve(operation());
	} catch (error) {
		return Promise.reject(error);
	}
}

export interface RecordingControllerLike {
	readonly state?: string;
	pause?(): boolean | void;
	resume?(): boolean | void;
	resumeConfirmed?(options: Readonly<{ startFrame: number }>): Promise<Readonly<{ startFrame: number }>>;
	stop(): MaybePromise<void>;
	dispose?(options?: Readonly<{ stopTracks?: boolean }>): MaybePromise<void>;
	setMonitoring?(enabled: boolean): void;
	setInputGain?(value: number): void;
}

export interface RecordingCaptureControllerLike extends RecordingControllerLike {
	start(options?: Readonly<{ startFrame?: number; stopFrame?: number }>): void;
	startConfirmed?(options: Readonly<{ startFrame: number; stopFrame?: number }>): Promise<Readonly<{ startFrame: number }>>;
	rescheduleConfirmed?(options: Readonly<{ startFrame: number; stopFrame?: number }>): Promise<Readonly<{ startFrame: number }>>;
	pause(): boolean | void;
	/** Invoke after native Pause flushes and serializes every preceding PCM write. */
	pauseAfterFlush?(onFlushed: () => void): boolean | void;
	resume(): boolean | void;
	setMonitoring(enabled: boolean): void;
	setInputGain(value: number): void;
}

export interface RoutedRecordingSourceSession {
	readonly kind: 'device' | 'display';
	readonly controller: RecordingCaptureControllerLike;
	disconnected: boolean;
	stopped: boolean;
	startFrame?: number;
	stopFrame?: number;
}

export interface RoutedRecordingController extends RecordingControllerLike {
	readonly state: 'ready' | 'recording' | 'paused' | 'stopping' | 'stopped' | 'disposed';
	start(): void;
	startConfirmed(minimumFutureFrame?: (attempt: number) => number, currentFrame?: () => number): Promise<number>;
	pause(): boolean;
	resume(): boolean;
	stop(): Promise<void>;
	dispose(): Promise<void>;
	setMonitoring(enabled: boolean): void;
	setInputGain(value: number): void;
}

export interface RecordingStartOptions {
	readonly trackId?: string;
	readonly multitrack?: boolean;
	readonly timedStartTimeMs?: number;
	readonly timedEndTimeMs?: number;
	readonly timedGeneration?: number;
	readonly reusePreparedInputsOnly?: boolean;
}

export interface RecordingStartScope {
	readonly signal?: AbortSignal;
	readonly reusePreparedInputsOnly?: boolean;
	readonly generation: number;
	readonly projectId: string | null;
	assertCurrent(): void;
	claimRecorder?(recorder: RecordingControllerLike): void;
	isHandedOff?(recorder: RecordingControllerLike): boolean;
	isCancellation?(error: unknown): boolean;
}

export interface RecordingSessionMutableState {
	readonly readOnly: boolean;
	readonly takeCycleRecovery?: unknown;
	readonly takeCycleRecoveryInspecting?: boolean;
	readonly disposed: boolean;
	readonly projectBinPreview: unknown | null;
	recorder: RecordingControllerLike | null;
	recordingKind: 'ordinary' | 'sound-activated' | 'take-cycle' | null;
	recordingStarting: boolean;
	recordingAdmissionPending?: boolean;
	recordingStartGeneration: number;
	recordingStartPromise: Promise<void> | null;
	timedRecordingPreparing: boolean;
	timedRecording: Readonly<{ generation: number }> | null;
	activeTimedRecording: Readonly<{ startTimeMs: number; options: Readonly<{ endTimeMs?: number }> }> | null;
	recordingPaused: boolean;
	leadInRecording: boolean;
	recordingEntries: readonly unknown[] | null;
	recordingWriter: unknown | null;
	recordingStream: unknown | null;
	recordingSourceId: string | null;
	recordingTrackId: string | null;
	recordingStartFrame: number;
	recordingSelection: unknown | null;
	recordingResampler: unknown | null;
	recordingSampleRate: number | null;
	recordingSourceOffsetFrames: number;
	recordingPreview: unknown | null;
	recordingPreviews: unknown[];
	recordingPreviewLastPublishedAt: number;
	recordingCleanup: (() => void) | null;
	recordingFinishing: boolean;
	recordingFinalizePromise: Promise<void> | null;
	recordingFatalError: unknown;
	recordingDiscardRequested: boolean;
	recordingReleaseAfterStop: boolean;
	inputMeterDb: number;
	inputMeters: Record<string, number>;
}

export interface RecordingFinalizationSnapshot {
	readonly recorder: RecordingControllerLike;
	readonly kind: 'ordinary' | 'sound-activated' | 'take-cycle';
	readonly entries: readonly unknown[] | null;
	readonly writer: unknown | null;
	readonly sourceId: string | null;
	readonly trackId: string | null;
	readonly startFrame: number;
	readonly sourceOffsetFrames: number;
	readonly selection: unknown | null;
	readonly resampler: unknown | null;
	readonly sampleRate: number | null;
	readonly preview: unknown | null;
	readonly discardRequested: boolean;
	readonly fatalError: unknown;
}

export interface RecordingSessionServiceRuntime {
	readonly state: RecordingSessionMutableState;
	readonly prepareRecordingStart?: (options: RecordingStartOptions, scope: RecordingStartScope, mode: 'ordinary' | 'new-track' | 'take-cycle', previousStart?: PromiseLike<void>) => MaybePromise<RecordingStartOptions> | undefined;
	readonly prepareRecordingOptions?: (options: RecordingStartOptions) => RecordingStartOptions;
	readonly getProjectId: () => string | null;
	readonly beginRecording: (
		options: RecordingStartOptions,
		scope: RecordingStartScope,
	) => MaybePromise<void | RecordingCaptureOutcome>;
	readonly beginTakeCycleRecording?: (
		scope: RecordingStartScope,
	) => MaybePromise<RecordingControllerLike>;
	readonly performLegacyFinalization: (
		snapshot: RecordingFinalizationSnapshot,
	) => MaybePromise<void>;
	readonly performRoutedFinalization: (
		snapshot: RecordingFinalizationSnapshot & { readonly entries: readonly unknown[] },
	) => MaybePromise<void>;
	readonly abortError?: () => Error;
	readonly addTrack?: (options: Readonly<{ armed: true }>) => string | null | undefined;
	readonly stopProjectBinPreview?: () => MaybePromise<unknown>;
	readonly cancelTimedRecording?: () => MaybePromise<unknown>;
	readonly releaseUnretainedRecordingInputs?: (
		options?: Readonly<{ force?: boolean }>,
	) => void;
	readonly retainInputs?: () => boolean;
	readonly playTransport?: (onBeforeStart?: (sourceStartTime: number) => Promise<number>) => MaybePromise<unknown>;
	readonly getTransportContext?: () => Promise<Readonly<{ currentTime: number; sampleRate: number }>>;
	readonly getTransportLatencyFrames?: () => number;
	readonly signal?: AbortSignal;
	readonly pauseTransport?: () => void;
	readonly getTransportState?: () => string;
	readonly updateTransportState?: (state: string) => void;
	readonly persistLeadIn?: (enabled: boolean) => MaybePromise<unknown>;
	readonly publishDocumentSnapshot?: () => void;
	readonly publishTelemetrySnapshot?: () => void;
	readonly syncRecordingPoolSnapshot?: () => void;
	readonly resetSoundActivationSources?: () => boolean;
	readonly setSoundActivationCaptureEnabled?: (enabled: boolean) => void;
	readonly canStartSoundActivatedRecording?: () => boolean;
	readonly handleError?: (error: unknown) => void;
}

/** Coordinate multiple capture controllers behind the legacy recorder port. */
export function createRoutedRecordingController(
	sourceSessions: readonly RoutedRecordingSourceSession[],
): RoutedRecordingController {
	let controllerState: RoutedRecordingController['state'] = 'ready';
	let generation = 0;
	let stopPromise: Promise<void> | null = null;
	let disposePromise: Promise<void> | null = null;
	return {
		get state() { return controllerState; },
		start() {
			controllerState = 'recording';
			for (const session of sourceSessions) {
				if (session.disconnected) {
					session.stopped = true;
					continue;
				}
				session.controller.start({
					startFrame: session.startFrame,
					stopFrame: session.stopFrame,
				});
			}
		},
		async startConfirmed(minimumFutureFrame, currentFrame) {
			const frame = await confirmRoutedRecordingStart(sourceSessions, minimumFutureFrame, currentFrame);
			controllerState = 'recording';
			return frame;
		},
		pause() {
			if (controllerState !== 'recording') return false;
			return transitionSources('pause');
		},
		resume() {
			if (controllerState !== 'paused') return false;
			return transitionSources('resume');
		},
		async resumeConfirmed(options) {
			const current = generation;
			try {
				const result = await confirmRoutedRecordingResume(sourceSessions, options.startFrame);
				if (generation !== current) throw new DOMException('Recording resume cancelled.', 'AbortError');
				controllerState = 'recording'; return result;
			} catch (error) { await beginStop(); throw error; }
		},
		stop() {
			if (stopPromise) return stopPromise;
			if (controllerState === 'stopped' || controllerState === 'disposed') return Promise.resolve();
			return beginStop();
		},
		setMonitoring(enabled) {
			for (const session of sourceSessions) {
				if (session.kind === 'device') session.controller.setMonitoring(enabled);
			}
		},
		setInputGain(value) {
			for (const session of sourceSessions) {
				if (session.kind === 'device') session.controller.setInputGain(value);
			}
		},
		dispose() {
			if (disposePromise) return disposePromise;
			generation++;
			disposePromise = Promise.allSettled(sourceSessions.map((session) => (
				invokeAsPromise(() => session.controller.dispose?.({ stopTracks: false }))
			))).then(() => { controllerState = 'disposed'; });
			return disposePromise;
		},
	};

	function transitionSources(direction: 'pause' | 'resume'): boolean {
		const transitioned = transitionRoutedRecordingSources(sourceSessions, direction, beginStop);
		if (transitioned) controllerState = direction === 'pause' ? 'paused' : 'recording';
		return transitioned;
	}

	function beginStop(): Promise<void> {
		if (stopPromise) return stopPromise;
		generation++;
		controllerState = 'stopping';
		stopPromise = Promise.allSettled(sourceSessions.map((session) => (
			session.stopped ? Promise.resolve() : invokeAsPromise(() => session.controller.stop())
		))).then(() => {
			for (const session of sourceSessions) session.stopped = true;
			if (controllerState !== 'disposed') controllerState = 'stopped';
		});
		return stopPromise;
	}
}

/** Coordinate capture and commit with shared start/finalize promise guards. */
export function createRecordingSessionService(runtime: RecordingSessionServiceRuntime) {
	const { state } = runtime;
	const publishDocumentSnapshot = runtime.publishDocumentSnapshot || (() => {});
	const releaseInputs = runtime.releaseUnretainedRecordingInputs || (() => {});
	const handleError = runtime.handleError || (() => {});
	let stopPromise: Promise<void> | null = null;

	const starts = createRecordingStartRequests(runtime, () => stopPromise !== null);
	const { startRecording, startSoundActivatedRecording, startRecordingOnNewTrack, startTakeCycleRecording, cancelRecordingStart: cancelStart } = starts;
	let pausedLatencyFrames = 0;
	let resuming: { recorder: RecordingControllerLike; projectId: string | null; generation: number;
		abort: AbortController; promise: Promise<boolean> } | null = null;
	const cancelResume = () => {
		const previous = resuming;
		resuming = null; previous?.abort.abort();
		if (previous && !state.disposed && !runtime.signal?.aborted && state.recorder === previous.recorder
			&& runtime.getProjectId() === previous.projectId) runtime.pauseTransport?.();
	};
	runtime.signal?.addEventListener('abort', cancelResume, { once: true });
	const cancelRecordingStart = () => { cancelResume(); return cancelStart(); };

	function resumeOnAudibleClock(recorder: RecordingControllerLike): Promise<boolean> {
		if (resuming?.recorder === recorder) return resuming.promise;
		const owned = { recorder, projectId: runtime.getProjectId(), generation: state.recordingStartGeneration,
			abort: new AbortController(), promise: Promise.resolve(false) };
		resuming = owned;
		const current = () => resuming === owned && !owned.abort.signal.aborted && !state.disposed && !state.recordingFinishing
			&& state.recorder === recorder && state.recordingPaused && runtime.getProjectId() === owned.projectId
			&& state.recordingStartGeneration === owned.generation;
		const assertCurrent = () => { if (!current()) throw new DOMException('Recording resume cancelled.', 'AbortError'); };
		owned.promise = Promise.resolve().then(async () => {
			try {
				await raceAbortableRead(() => runtime.playTransport!(async candidate => {
					assertCurrent(); const context = await runtime.getTransportContext!(); assertCurrent();
					const timing = recordingResumeTiming(context, candidate, runtime.getTransportLatencyFrames?.() ?? 0);
					let confirmed = await recorder.resumeConfirmed!({ startFrame: timing.requestedFrame });
					for (let attempt = 0; attempt <= 4; attempt++) {
						assertCurrent();
						if (timing.isFuture(confirmed.startFrame)) return timing.sourceTime(confirmed.startFrame);
						if (attempt === 4) break;
						confirmed = await recorder.resumeConfirmed!({ startFrame: timing.minimumFutureFrame(attempt) });
					}
					throw new Error('The recording input could not confirm a future audible resume.');
				}), owned.abort.signal, 'immediate');
				if (!current()) return state.recordingPaused;
				state.recordingPaused = false; runtime.updateTransportState?.('recording'); publishDocumentSnapshot(); return false;
			} catch (error) {
				if (!current()) return state.recordingPaused;
				runtime.pauseTransport?.(); throw error;
			} finally { if (resuming === owned) resuming = null; }
		});
		return owned.promise;
	}

	function toggleRecordingPause(): boolean | Promise<boolean> {
		if (!state.recorder) return false;
		if (state.recordingKind === 'take-cycle') return false;
		if (state.recordingPaused) {
			if (pausedLatencyFrames > 0 && runtime.getTransportState?.() === 'paused'
				&& state.recorder.resumeConfirmed && runtime.playTransport && runtime.getTransportContext) return resumeOnAudibleClock(state.recorder);
			const resumed = state.recorder.resume?.();
			if (resumed !== false) {
				state.recordingPaused = false;
				// A completed backing run stays completed while microphone capture
				// continues. Only a transport paused with this take needs restarting.
				if (!runtime.getTransportState || runtime.getTransportState() === 'paused') void runtime.playTransport?.();
				runtime.updateTransportState?.('recording');
			}
		} else {
			const latencyFrames = runtime.getTransportLatencyFrames?.() ?? 0;
			const paused = state.recorder.pause?.();
			if (paused !== false) {
				pausedLatencyFrames = latencyFrames;
				state.recordingPaused = true;
				runtime.pauseTransport?.();
				runtime.updateTransportState?.('paused-recording');
			}
		}
		publishDocumentSnapshot();
		return state.recordingPaused;
	}

	function toggleLeadInRecording(): boolean {
		if (state.recorder || state.recordingStarting || state.recordingAdmissionPending || state.timedRecordingPreparing || state.timedRecording) {
			return state.leadInRecording;
		}
		state.leadInRecording = !state.leadInRecording;
		void runtime.persistLeadIn?.(state.leadInRecording);
		publishDocumentSnapshot();
		return state.leadInRecording;
	}

	function finalizationSnapshot(): RecordingFinalizationSnapshot | null {
		if (!state.recorder) return null;
		return Object.freeze({
			recorder: state.recorder,
			kind: state.recordingKind ?? 'ordinary',
			entries: state.recordingEntries,
			writer: state.recordingWriter,
			sourceId: state.recordingSourceId,
			trackId: state.recordingTrackId,
			startFrame: state.recordingStartFrame,
			sourceOffsetFrames: state.recordingSourceOffsetFrames,
			selection: state.recordingSelection,
			resampler: state.recordingResampler,
			sampleRate: state.recordingSampleRate,
			preview: state.recordingPreview,
			discardRequested: state.recordingDiscardRequested,
			fatalError: state.recordingFatalError,
		});
	}

	function resetFinalizedState(): void {
		pausedLatencyFrames = 0;
		try {
			state.recordingCleanup?.();
		} catch (error) {
			handleError(error);
		}
		state.recordingCleanup = null;
		state.recorder = null;
		starts.clearScope();
		state.activeTimedRecording = null;
		state.recordingKind = null;
		runtime.setSoundActivationCaptureEnabled?.(false);
		state.recordingEntries = null;
		state.recordingWriter = null;
		state.recordingStream = null;
		state.recordingSourceId = null;
		state.recordingTrackId = null;
		state.recordingSelection = null;
		state.recordingResampler = null;
		state.recordingSampleRate = null;
		state.recordingSourceOffsetFrames = 0;
		state.recordingPreview = null;
		state.recordingPreviews = [];
		state.recordingPreviewLastPublishedAt = 0;
		state.recordingPaused = false;
		state.recordingFinishing = false;
		state.recordingFatalError = null;
		state.recordingDiscardRequested = false;
		state.inputMeterDb = -60;
		state.inputMeters = {};
		if (!runtime.retainInputs?.() || state.recordingReleaseAfterStop) {
			releaseInputs({ force: state.recordingReleaseAfterStop });
		}
		state.recordingReleaseAfterStop = false;
		runtime.resetSoundActivationSources?.();
		runtime.syncRecordingPoolSnapshot?.();
		runtime.publishTelemetrySnapshot?.();
		runtime.updateTransportState?.(runtime.getTransportState?.() || 'stopped');
		publishDocumentSnapshot();
	}

	async function performFinalizeRecording(): Promise<void> {
		if (!state.recorder || state.recordingFinishing) return;
		const snapshot = finalizationSnapshot();
		if (!snapshot) return;
		state.recordingFinishing = true;
		publishDocumentSnapshot();
		try {
			if (snapshot.kind === 'take-cycle') await snapshot.recorder.stop();
			else if (snapshot.entries) {
				await runtime.performRoutedFinalization({ ...snapshot, entries: snapshot.entries });
			} else await runtime.performLegacyFinalization(snapshot);
		} finally {
			resetFinalizedState();
		}
	}

	function finalizeRecording(): Promise<void> {
		cancelResume();
		if (state.recordingFinalizePromise) return state.recordingFinalizePromise;
		if (!state.recorder || state.recordingFinishing) return Promise.resolve();
		const scope = starts.scope;
		scope?.claimRecorder(state.recorder);
		if (state.recordingStarting || state.recordingStartPromise) cancelRecordingStart();
		const operation = performFinalizeRecording();
		const tracked = operation.finally(() => {
			if (state.recordingFinalizePromise === tracked) state.recordingFinalizePromise = null;
		});
		state.recordingFinalizePromise = tracked;
		scope?.claimFinalization(tracked);
		return tracked;
	}

	async function stopRecording(): Promise<unknown> {
		cancelResume();
		if (state.timedRecording || state.timedRecordingPreparing) return runtime.cancelTimedRecording?.();
		if (stopPromise) return stopPromise;
		let resolveStop!: () => void;
		let rejectStop!: (reason: unknown) => void;
		const operation = new Promise<void>((resolve, reject) => { resolveStop = resolve; rejectStop = reject; });
		const tracked = operation.finally(() => { if (stopPromise === tracked) stopPromise = null; });
		stopPromise = tracked;
		void stopOwnedRecording({ state, scope: starts.scope,
			cancelStart: cancelRecordingStart, publish: publishDocumentSnapshot, finalize: finalizeRecording }).then(resolveStop, rejectStop);
		return tracked;
	}

	return Object.freeze({
		cancelRecordingStart,
		finalizeRecording,
		startRecording,
		startSoundActivatedRecording,
		startRecordingOnNewTrack,
		startTakeCycleRecording,
		stopRecording,
		toggleLeadInRecording,
		toggleRecordingPause,
	});
}
