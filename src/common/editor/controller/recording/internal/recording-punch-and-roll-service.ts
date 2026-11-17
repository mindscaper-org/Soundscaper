/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ControllerRecordingState, RecordingPunchTarget } from '../recording-state.ts';
import type { RecordingProject, RecordingSelection } from '../recording-transaction-types.ts';
import type { RecordingStartOptions } from './recording-session-service.ts';
import { normalizeRecordingLeadInSeconds } from '../recording-model.ts';
import { assertRecordingTargetsUnlocked } from '../../../recording-target-admission.ts';

interface PunchAndRollRuntime<Token> {
	readonly state: Pick<ControllerRecordingState,
		'lastRecordingPunch' | 'leadInDurationSeconds' | 'recorder' | 'recordingKind' |
		'recordingStarting' | 'recordingAdmissionPending' | 'timedRecordingPreparing' | 'timedRecording'
	> & { readonly readOnly: boolean; readonly disposed: boolean; readonly takeCycleRecovery?: unknown };
	getProject(): RecordingProject | null;
	captureCurrent(): Token;
	assertCurrent(token: Token): void;
	stopRecording(): Promise<unknown>;
	startRecording(options: RecordingStartOptions): Promise<void> | undefined;
	pauseTransport(): void;
	seek(frame: number): void;
	persistDuration(seconds: number): Promise<unknown>;
	publish(): void;
}

/** Retry owns the original capture target while stop and publication settle. */
export function createRecordingPunchAndRollService<Token>(runtime: PunchAndRollRuntime<Token>) {
	const { state } = runtime;
	let remembered: { target: RecordingPunchTarget; token: Token } | null = null;
	let retry: Promise<boolean> | null = null;
	let retryGeneration = 0;
	let durationWrite = Promise.resolve(false);
	const blocked = () => state.disposed || state.readOnly || Boolean(state.takeCycleRecovery)
		|| state.recordingStarting || state.recordingAdmissionPending
		|| state.timedRecordingPreparing || Boolean(state.timedRecording);
	function rememberPunch(startFrame: number, selection: RecordingSelection | null, trackIds: readonly string[]): void {
		const project = runtime.getProject();
		if (!project || !trackIds.length) return;
		const target = Object.freeze({ projectId: project.id, startFrame,
			selection: selection ? Object.freeze({ ...selection }) : null, trackIds: Object.freeze([...trackIds]) });
		remembered = { target, token: runtime.captureCurrent() };
		state.lastRecordingPunch = target;
	}
	function punchAgain(): Promise<boolean> {
		if (retry) return retry;
		const current = remembered;
		const project = runtime.getProject();
		if (!current || blocked() || current.target.projectId !== project?.id
			|| state.recorder && state.recordingKind !== 'ordinary') return Promise.resolve(false);
		const { startFrame, selection, trackIds } = current.target;
		const targetTracks = (candidate: RecordingProject | null) => trackIds.map(id => candidate?.tracks.find(track => track.id === id && track.type === 'audio'));
		const tracks = targetTracks(project);
		if (tracks.some(track => !track)) return Promise.resolve(false);
		const generation = retryGeneration;
		const operation = (async () => {
			runtime.assertCurrent(current.token);
			assertRecordingTargetsUnlocked(tracks.filter(track => track !== undefined));
			await runtime.stopRecording();
			runtime.assertCurrent(current.token);
			if (generation !== retryGeneration || blocked() || state.recorder) return false;
			const currentTracks = targetTracks(runtime.getProject());
			if (currentTracks.some(track => !track)) return false;
			assertRecordingTargetsUnlocked(currentTracks.filter(track => track !== undefined));
			runtime.pauseTransport();
			runtime.seek(startFrame);
			const started = runtime.startRecording({ ...(trackIds.length === 1 ? { trackId: trackIds[0] } : { multitrack: true }),
				punch: { startFrame, selection, trackIds } });
			if (!started) return false;
			await started;
			return true;
		})();
		retry = operation.finally(() => { retry = null; });
		return retry;
	}
	async function setLeadInDurationSeconds(value: number): Promise<boolean> {
		const seconds = normalizeRecordingLeadInSeconds(value);
		if (seconds === null) throw new RangeError('Choose a lead-in duration.');
		if (blocked() || state.recorder) return false;
		durationWrite = durationWrite.catch(() => false).then(async () => {
			if (state.disposed) return false;
			await runtime.persistDuration(seconds);
			if (state.disposed) return false;
			state.leadInDurationSeconds = seconds;
			runtime.publish();
			return true;
		});
		return durationWrite;
	}
	function cancelPendingRetry(): void {
		retryGeneration++;
		if (!remembered) return;
		// Project switching invalidates its generation before cancelling capture.
		try { runtime.assertCurrent(remembered.token); }
		catch { remembered = null; state.lastRecordingPunch = null; }
	}
	return Object.freeze({ rememberPunch, punchAgain, setLeadInDurationSeconds,
		cancelPendingRetry });
}
