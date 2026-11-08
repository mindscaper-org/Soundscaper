/* SPDX-License-Identifier: AGPL-3.0-only */
import { recordingTrackRoute, recordingRouteSourceKey, type RecordingRoute } from '../../../recording-routing.js';
import { planRoutedRecordingSources } from './routed-recording-source-plan.ts';
import type { RecordingCapturePool, RecordingEnginePort, RecordingProject } from '../recording-transaction-types.ts';
import type { RecordingSessionServiceRuntime } from './recording-session-service.ts';
import { raceAbortablePromise } from '../../../../foundation/abort-race.ts';

function invoke<Value>(operation: () => Promise<Value>): Promise<Value> {
	try { return operation(); } catch (error) { return Promise.reject(error); }
}

export interface PendingRecordingDocumentEdits<Project> {
	hasPendingEdits(): boolean;
	settled(expectedProject: Project, readiness?: PromiseLike<unknown>): Promise<void>;
}

/** Stage permission-sensitive work now; adopt the document only after prior MIDI has published. */
export function createRecordingMidiAdmission<Project extends RecordingProject>(runtime: Readonly<{
	pending?: PendingRecordingDocumentEdits<Project>;
	getProject(): Project;
	getRoutes(): Readonly<Record<string, RecordingRoute>>;
	getPreferredInput(): Readonly<{ deviceId: string; channelCount: number }>;
	sampleRate(): number;
	readonly capturePool: RecordingCapturePool;
	readonly engine: Pick<RecordingEnginePort, 'getAudioContext'>;
	releaseInputs(): void;
}>): NonNullable<RecordingSessionServiceRuntime['prepareRecordingStart']> {
	return (options, scope, mode, previousStart) => {
		const pending = runtime.pending;
		const pendingMidi = pending?.hasPendingEdits() ?? false;
		if (!pendingMidi && !previousStart) return undefined;
		const project = runtime.getProject();
		const route = options.trackId ? recordingTrackRoute(runtime.getRoutes(), options.trackId) : null;
		const legacy = options.trackId && (!route || (route.kind === 'device' && route.deviceId === 'default'
			&& route.channelStart === 0 && route.channelCount === 2));
		const preferred = runtime.getPreferredInput();
		const sources: readonly Readonly<{ route: RecordingRoute; channels: number }>[] = mode === 'new-track'
			? [{ route: preferred.deviceId === 'display' ? { kind: 'display', channelStart: 0, channelCount: preferred.channelCount }
				: { kind: 'device', deviceId: preferred.deviceId, channelStart: 0, channelCount: preferred.channelCount }, channels: preferred.channelCount }]
			: legacy ? [{ route: { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 2 }, channels: 2 }]
				: planRoutedRecordingSources(options.trackId ? project.tracks.filter(track => track.id === options.trackId)
					: project.tracks.filter(track => track.type === 'audio' && track.armed), runtime.getRoutes(), recordingRouteSourceKey).groups
					.map(group => ({ route: group.routes[0]!.route, channels: Math.max(...group.routes.map(item => item.route.channelStart + item.route.channelCount)) }));
		// Keep display permission in the invoking gesture, ahead of every await.
		const acquisitions = options.reusePreparedInputsOnly ? [] : sources.map(source => invoke(() => source.route.kind === 'display'
			? runtime.capturePool.acquireDisplay() : runtime.capturePool.acquireHardware(source.route.deviceId, {
				channelCount: source.channels, sampleRate: runtime.sampleRate(),
			})));
		const context = invoke(() => runtime.engine.getAudioContext()).then(async value => { await value.resume(); });
		const preparation = Promise.allSettled([context, ...acquisitions]);
		const readiness = raceAbortablePromise(Promise.all([preparation, previousStart]).then(([prepared]) => prepared), scope.signal);
		void readiness.catch(() => undefined);
		const fenced = pendingMidi && pending ? invoke(() => pending.settled(project, readiness)) : Promise.resolve();
		void fenced.catch(() => undefined);
		const admission = Promise.all([fenced, readiness]).then(([, results]) => {
			scope.assertCurrent();
			const contextResult = results[0];
			if (contextResult?.status === 'rejected') throw contextResult.reason;
			// A routed take may retain surviving inputs; its established capture owner
			// diagnoses unavailable sources without opening a second permission prompt.
			return { ...options, reusePreparedInputsOnly: true };
		});
		return raceAbortablePromise(admission, scope.signal).catch((error: unknown) => {
			// Stop releases synchronously and invalidates late native grants. A late
			// canceled completion must never release a newer start's capture inputs.
			if (!scope.signal?.aborted) runtime.releaseInputs();
			throw error;
		});
	};
}
