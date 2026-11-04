/* SPDX-License-Identifier: AGPL-3.0-only */
import { abortable, createAbortError, throwIfAborted } from './async-utils.ts';
import { prepareExactAudioWarpPlayback, projectHasAuthoredAudioWarp } from './audio-warp-fallback.ts';
import { clampFrame } from './buffer-math.ts';
import { ensureProjectWorklets } from './effect-worklets.ts';
import { createProjectRefreshCandidate } from './project-refresh-candidate.ts';
import { ownProjectRefresh, retireProjectGraph } from './project-refresh-state.ts';
import { switchPlaybackGraphOutput } from './playback-graph-output.ts';
import { isPlaybackLoopEnabled, playbackFrequencyRange } from './playback-frequency-range.ts';
import { projectGraphLatencyFrames } from './project-graph.ts';
import { playbackSessionStart, restorePlaybackSessionStart } from './playback-session.ts';
import { playbackPitchPreserver } from './project-refresh-speed.ts';
import { prepareSpeedRender } from './prepared-speed-render.ts';
import { waitForPlaybackBoundary } from './project-refresh-boundary.ts';
import { ENGINE_SCHEDULE_PLAYBACK, ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK, ENGINE_START_TICKER,
	ENGINE_STOP_TICKER, ENGINE_SCHEDULE_LOOP_AHEAD, ENGINE_EMIT_POSITION, ENGINE_HALT_GRAPH, ENGINE_ENSURE_MASTER_LOUDNESS_METER } from './runtime-symbols.ts';
import type { EngineLoadProjectOptions, EngineSourceBufferInput } from './public-api.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';
import type { EngineProject } from './types.ts';

class MissedHandoff extends Error {}

/** Resolve the running clock at the future audible boundary, including loop wrap. */
function playbackFrameAt(engine: EngineRuntimeHost, time: number): number {
	const elapsed = Math.floor(Math.max(0, time - engine.playbackStartTime) * engine.sampleRate * engine.playbackRate);
	if (isPlaybackLoopEnabled(engine) && engine.loop.endFrame > engine.loop.startFrame) {
		const initial = Math.max(0, engine.loop.endFrame - engine.playbackStartFrame);
		if (elapsed >= initial) return engine.loop.startFrame + (elapsed - initial) % (engine.loop.endFrame - engine.loop.startFrame);
	}
	return Math.min(engine.playbackStartFrame + elapsed, engine.playEndFrame);
}

export async function refreshPlayingProject(engine: EngineRuntimeHost, project: EngineProject,
	sources: EngineSourceBufferInput, options: EngineLoadProjectOptions): Promise<void> {
	throwIfAborted(options.signal);
	const generation = engine.scrubGeneration;
	const originalGraph = engine.graph;
	const sessionStart = playbackSessionStart(engine);
	const controller = new AbortController();
	const prepared = createProjectRefreshCandidate(engine, project, sources, options);
	const { candidate } = prepared;
	const cancel = () => { controller.abort(); prepared.dispose(); };
	const release = ownProjectRefresh(engine, cancel);
	const signal = controller.signal;
	options.signal?.addEventListener('abort', cancel, { once: true });
	const naturallyEnded = (): boolean => engine.state === 'stopped' && engine.graph === null
		&& originalGraph?.abortController.signal.aborted === true;
	const current = (): void => {
		throwIfAborted(signal); throwIfAborted(options.signal);
		if (engine.disposed || engine.scrubGeneration !== generation || options.isCurrent?.() === false
			|| (engine.graph !== originalGraph && !naturallyEnded())) throw createAbortError();
	};
	const commitStopped = (position: number): void => {
		current(); prepared.dispose(); release();
		engine.loadProject(project, sources, { ...options, preserveLoudnessMeasurement: true });
		engine.positionFrame = Math.min(position, engine.playbackDurationFrames);
		engine[ENGINE_EMIT_POSITION]();
	};
	try {
		candidate.playbackMode = engine.playbackMode;
		candidate.playbackRate = engine.playbackRate;
		candidate.setPlayRange(engine.playRange);
		candidate.setPlaybackFrequencyRange(playbackFrequencyRange(engine));
		const context = await abortable(candidate.getAudioContext(), signal);
		current();
		if (naturallyEnded()) { commitStopped(engine.getPositionFrames()); return; }
		if (candidate.playbackMode === 'staffpad') {
			await abortable(prepareSpeedRender(candidate, candidate.playbackRate, playbackPitchPreserver(engine), signal, null, current), signal);
		} else if (projectHasAuthoredAudioWarp(candidate.project) && candidate.getAudioWarpRenderStatus().path === 'exact-offline') {
			candidate.playbackMode = 'audio-warp-exact';
		} else {
			if (candidate.playbackMode !== 'naive') candidate.playbackMode = 'normal';
			await abortable(ensureProjectWorklets(context, project), signal);
		}
		current();
		await abortable(candidate[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context), signal);
		current();
		let lead = 0.04;
		let latencyFrames = (candidate.playbackMode === 'normal' || candidate.playbackMode === 'naive') && candidate.projectGraphSelection !== 'v21'
			? projectGraphLatencyFrames(candidate.project, { sampleRate: context.sampleRate, graph: candidate.projectGraphSelection ?? undefined }) : 0;
		for (;;) {
			current();
			if (naturallyEnded()) { commitStopped(engine.getPositionFrames()); return; }
			const startedPreparing = context.currentTime;
			const boundary = Math.max(startedPreparing + lead + latencyFrames / context.sampleRate, engine.playbackStartTime);
			const sourceTime = boundary - latencyFrames / context.sampleRate;
			const fromFrame = clampFrame(playbackFrameAt(engine, boundary), 0, candidate.playbackDurationFrames);
			if ((candidate.playRange && fromFrame >= candidate.playRange.endFrame)
				|| (candidate.playbackMode === 'audio-warp-exact' && !isPlaybackLoopEnabled(candidate) && fromFrame >= candidate.durationFrames)) {
				const oldEnd = engine.playRange?.endFrame;
				if (oldEnd !== undefined && oldEnd <= (candidate.playRange?.endFrame ?? candidate.durationFrames)) {
					await waitForPlaybackBoundary(engine, oldEnd, signal, current);
				}
				commitStopped(Math.min(fromFrame, candidate.playRange?.endFrame ?? candidate.durationFrames));
				return;
			}
			candidate.positionFrame = fromFrame;
			if (candidate.playbackMode === 'audio-warp-exact') {
				await abortable(prepareExactAudioWarpPlayback(candidate, fromFrame,
					isPlaybackLoopEnabled(candidate) ? candidate.loop.endFrame : candidate.durationFrames, signal), signal);
				current();
			}
			const onReady = async (requested: number): Promise<number> => {
				current();
				const actualLatency = candidate.graph?.latencyFrames ?? 0;
				if (requested > sourceTime + 1 / context.sampleRate || sourceTime <= context.currentTime
					|| actualLatency !== latencyFrames) {
					latencyFrames = actualLatency;
					throw new MissedHandoff();
				}
				return sourceTime;
			};
			try {
				if (candidate.playbackMode === 'staffpad' || candidate.playbackMode === 'audio-warp-exact') {
					await abortable(candidate[ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK](fromFrame, sourceTime, 0, onReady), signal);
				} else await abortable(candidate[ENGINE_SCHEDULE_PLAYBACK](fromFrame, sourceTime, 0, onReady), signal);
			} catch (error) {
				if (!(error instanceof MissedHandoff)) throw error;
				candidate[ENGINE_HALT_GRAPH]();
				lead = Math.max(lead * 2, (context.currentTime - startedPreparing) * 2 + 0.04);
				continue;
			}
			current();
			if (!originalGraph || !candidate.graph) throw createAbortError();
			switchPlaybackGraphOutput(originalGraph, candidate.graph, boundary);
			engine[ENGINE_STOP_TICKER]();
			release(); const retireMeter = prepared.promote();
			restorePlaybackSessionStart(engine, sessionStart);
			retireProjectGraph(engine, originalGraph, boundary, retireMeter);
			engine.masterLoudnessMeter?.setRunning(!engine.loudnessMeasurementManuallyPaused);
			engine[ENGINE_SCHEDULE_LOOP_AHEAD]();
			engine[ENGINE_START_TICKER]();
			engine[ENGINE_EMIT_POSITION]();
			return;
		}
	} finally {
		release();
		options.signal?.removeEventListener('abort', cancel);
		prepared.dispose();
	}
}
