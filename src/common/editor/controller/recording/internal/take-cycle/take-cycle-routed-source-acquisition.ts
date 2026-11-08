/* SPDX-License-Identifier: AGPL-3.0-only */

import { positiveTakeCycleRoutedInteger } from './take-cycle-routed-capture-validation.ts';
import type { TakeCycleRoutedCaptureRuntime } from './take-cycle-routed-capture-types.ts';
import type { RecordingRoute, RecordingTrack } from '../../recording-transaction-types.ts';
import type { TakeCycleRoutedLiveLane, TakeCycleRoutedLiveSource } from './take-cycle-routed-capture-state.ts';

export interface TakeCycleRoutedAcquisitionLane {
	readonly track: RecordingTrack;
	readonly route: RecordingRoute;
}

export interface TakeCycleRoutedAcquiredSource {
	readonly sourceKey: string;
	readonly kind: 'device' | 'display';
	readonly stream: Awaited<ReturnType<TakeCycleRoutedCaptureRuntime['capturePool']['acquireHardware']>>;
	readonly channelCount: number;
	readonly lanes: readonly TakeCycleRoutedAcquisitionLane[];
}

/** Attach the live controller slots to the same acquired source objects used by capture. */
export async function acquireTakeCycleRoutedLiveSources(
	groups: readonly Readonly<{ readonly sourceKey: string; readonly routes: readonly TakeCycleRoutedAcquisitionLane[] }>[],
	lanes: TakeCycleRoutedLiveLane[],
	projectSampleRate: number,
	runtime: TakeCycleRoutedCaptureRuntime,
	failLane: (lane: TakeCycleRoutedLiveLane, error: unknown) => Promise<void>,
	reusePreparedInputsOnly = false,
): Promise<TakeCycleRoutedLiveSource[]> {
	const laneFor = (trackId: string) => lanes.find(lane => lane.track.id === trackId)!;
	const acquired = await acquireTakeCycleRoutedSources(groups, projectSampleRate, runtime,
		async ({ track }, error) => failLane(laneFor(track.id), error), reusePreparedInputsOnly);
	return acquired.map(source => ({
		...source, lanes: source.lanes.map(({ track }) => laneFor(track.id)),
		controller: null, tail: Promise.resolve(), accepting: true, stopping: false, expectedFrameStart: null,
	}));
}

export async function acquireTakeCycleRoutedSources(
	groups: readonly Readonly<{ readonly sourceKey: string; readonly routes: readonly TakeCycleRoutedAcquisitionLane[] }>[],
	projectSampleRate: number,
	runtime: Pick<TakeCycleRoutedCaptureRuntime,
		'capturePool' | 'recordingStreamIsLive' | 'streamAudioChannelCount'
	>,
	failLane: (lane: TakeCycleRoutedAcquisitionLane, error: unknown) => Promise<void>,
	reusePreparedInputsOnly = false,
): Promise<readonly TakeCycleRoutedAcquiredSource[]> {
	const acquisitions = groups.map(async ({ sourceKey, routes }) => {
		const first = routes[0]?.route;
		if (!first) throw new Error('Take cycle routed source group is empty.');
		const requiredChannels = Math.max(...routes.map(({ route }) => route.channelStart + route.channelCount));
		const stream = reusePreparedInputsOnly
			? first.kind === 'display' ? runtime.capturePool.getDisplay?.() : runtime.capturePool.getHardware?.(first.deviceId)
			: first.kind === 'display'
			? await runtime.capturePool.acquireDisplay()
			: await runtime.capturePool.acquireHardware(first.deviceId, {
				channelCount: requiredChannels, sampleRate: projectSampleRate,
			});
		if (!stream) throw new Error(`Take cycle routed input ${sourceKey} is unavailable.`);
		return { sourceKey, routes, first, stream };
	});
	const settled = await Promise.allSettled(acquisitions);
	const sources: TakeCycleRoutedAcquiredSource[] = [];
	for (let index = 0; index < settled.length; index += 1) {
		const result = settled[index]!;
		const group = groups[index]!;
		if (result.status === 'rejected') {
			for (const route of group.routes) await failLane(route, result.reason);
			continue;
		}
		const { first, stream } = result.value;
		if (!runtime.recordingStreamIsLive(stream, first.kind)) {
			const error = new Error(`Take cycle routed input ${group.sourceKey} is disconnected.`);
			for (const route of group.routes) await failLane(route, error);
			continue;
		}
		const channelCount = positiveTakeCycleRoutedInteger(
			runtime.streamAudioChannelCount(stream), 64, 'routed input channel count',
		);
		const surviving: TakeCycleRoutedAcquisitionLane[] = [];
		for (const lane of group.routes) {
			if (lane.route.kind === 'display'
				|| lane.route.channelStart + lane.route.channelCount <= channelCount) {
				surviving.push(lane);
			} else {
				await failLane(lane, new Error(`Take cycle route ${lane.track.id} exceeds its input channels.`));
			}
		}
		sources.push({ sourceKey: group.sourceKey, kind: first.kind, stream, channelCount, lanes: surviving });
	}
	return Object.freeze(sources);
}
