/* SPDX-License-Identifier: AGPL-3.0-only */
import { stagePlaybackOutput } from './playback-graph-output.ts';
import { inheritParallelStackPlayback } from './parallel-stack-playback.ts';
import { inheritPlaybackSourceResolver } from './playback-source-resolver.ts';
import { disposePlaybackFrequencyOutput } from './playback-frequency-range.ts';
import { ENGINE_START_TICKER, ENGINE_SCHEDULE_LOOP_AHEAD, ENGINE_CANCEL_SCRUB, ENGINE_HALT_GRAPH } from './runtime-symbols.ts';
import type { EngineLoadProjectOptions, EngineSourceBufferInput } from './public-api.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';
import type { EngineProject } from './types.ts';

const committedKeys = [
	'project', 'projectGraphSelection', 'sources', 'chunkSources', 'sourceResolver', 'chunkStreamClient',
	'durationFrames', 'playbackDurationFrames', 'positionFrame', 'playbackStartFrame', 'playbackStartTime',
	'playEndFrame', 'loopScheduleTime', 'playbackRate', 'playbackMode', 'preparedSpeedPlayback',
	'preparedAudioWarpPlayback', 'audioWarpPlaybackPreparation', 'loop', 'playRange', 'graph',
] as const satisfies readonly (keyof EngineRuntimeHost)[];

/** Async source/worker callbacks follow the live host after an accepted handoff. */
export function createProjectRefreshCandidate(engine: EngineRuntimeHost, project: EngineProject,
	sources: EngineSourceBufferInput, options: EngineLoadProjectOptions) {
	let promoted = false;
	let disposed = false;
	const target: EngineRuntimeHost = Object.assign(Object.create(Object.getPrototypeOf(engine)) as EngineRuntimeHost, engine, {
		context: null, graph: null, ticker: null, scrubTimer: null, project: null,
		masterLoudnessMeter: null, masterLoudnessMeterPromise: null,
		masterLoudnessMeterChannelCount: null, masterLoudnessMeterChannelWeights: null,
		positionListeners: new Set(), stateListeners: new Set(), playbackErrorListeners: new Set(),
		parametricEqErrorListeners: new Set(),
		[ENGINE_START_TICKER]: () => undefined,
		[ENGINE_SCHEDULE_LOOP_AHEAD]: () => undefined,
	});
	const candidate = new Proxy(target, {
		get: (_target, key, receiver) => Reflect.get(promoted ? engine : target, key, receiver),
		set: (_target, key, value) => Reflect.set(promoted ? engine : target, key, value),
	});
	inheritPlaybackSourceResolver(engine, candidate);
	candidate.loadProject(project, sources, options);
	candidate.context = engine.context;
	candidate.scrubGeneration = engine.scrubGeneration;
	candidate.masterLoudnessMeter = engine.masterLoudnessMeter;
	candidate.masterLoudnessMeterChannelCount = engine.masterLoudnessMeterChannelCount;
	candidate.masterLoudnessMeterChannelWeights = engine.masterLoudnessMeterChannelWeights;
	candidate.masterLoudnessMeterError = engine.masterLoudnessMeterError;
	// Stage schedulers may stop their own meter, but the shared session keeps measuring old audio.
	const meter = engine.masterLoudnessMeter;
	if (meter) candidate.masterLoudnessMeter = { node: meter.node,
		setRunning: () => undefined, reset: () => undefined, requestSnapshot: () => undefined, dispose: () => undefined };
	const sharedMeter = candidate.masterLoudnessMeter;
	inheritParallelStackPlayback(engine, candidate);
	stagePlaybackOutput(candidate);
	return {
		candidate,
		promote(): (() => void) | undefined {
			const previousMeter = engine.masterLoudnessMeter;
			const replacementMeter = target.masterLoudnessMeter === sharedMeter ? previousMeter : target.masterLoudnessMeter;
			engine.masterLoudnessMeter = replacementMeter;
			engine.masterLoudnessMeterChannelCount = target.masterLoudnessMeterChannelCount;
			engine.masterLoudnessMeterChannelWeights = target.masterLoudnessMeterChannelWeights;
			engine.masterLoudnessMeterError = target.masterLoudnessMeterError;
			for (const key of committedKeys) Reflect.set(engine, key, target[key]);
			promoted = true;
			return previousMeter && previousMeter !== replacementMeter ? () => previousMeter.dispose() : undefined;
		},
		dispose(): void {
			if (promoted || disposed) return;
			disposed = true;
			candidate[ENGINE_CANCEL_SCRUB]();
			candidate[ENGINE_HALT_GRAPH]();
			disposePlaybackFrequencyOutput(candidate);
			if (candidate.masterLoudnessMeter !== sharedMeter) candidate.masterLoudnessMeter?.dispose();
			if (candidate.chunkStreamClient !== engine.chunkStreamClient) candidate.chunkStreamClient?.dispose?.();
			candidate.disposed = true;
		},
	};
}
