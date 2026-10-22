/* SPDX-License-Identifier: AGPL-3.0-only */

import { soundscaperNativeAudioDestination } from '../soundscaper-native-audio-renderer.ts';
import { addNode, connect, getTransientNodes, releaseTransientNodes } from './audio-node-utils.ts';
import { scheduleExactWarpPlayback } from './audio-warp-playback-scheduler.ts';
import { confirmClockedPlaybackStart, type ClockedPlaybackStartHook } from './clocked-playback-start.ts';
import { clampFrame, playRangeStopFrame } from './buffer-math.ts';
import { createAnalyser } from './effect-rack.ts';
import { playbackOutputDestination } from './playback-output.ts';
import { isPlaybackLoopEnabled } from './playback-frequency-range.ts';
import { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';
import { ENGINE_EMIT_POSITION, ENGINE_ENSURE_MASTER_LOUDNESS_METER, ENGINE_HALT_GRAPH, ENGINE_SET_STATE,
	ENGINE_START_TICKER } from './runtime-symbols.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';

/** Play a prepared mix, preserving the authored timeline around its PCM body. */
export async function schedulePreparedSpeedPlayback(engine: EngineRuntimeHost, fromFrame: number, scheduledTime: number,
	current: () => boolean, minimumStartLeadSeconds = 0, onBeforeStart?: ClockedPlaybackStartHook): Promise<number> {
	const context = engine.context;
	const project = engine.project;
	if (engine.playbackMode === 'audio-warp-exact' && engine.preparedAudioWarpPlayback) {
		return scheduleExactWarpPlayback(
			engine,
			engine.preparedAudioWarpPlayback,
			fromFrame,
			scheduledTime,
			current,
			minimumStartLeadSeconds,
			onBeforeStart,
		);
	}
	const prepared = engine.preparedSpeedPlayback;
	if (!context || !project || !prepared) return scheduledTime;
	if (engine.meterListeners.size && !engine.masterLoudnessMeter && !engine.masterLoudnessMeterError) {
		await engine[ENGINE_ENSURE_MASTER_LOUDNESS_METER](context);
	}
	if (!current()) return scheduledTime;
	engine[ENGINE_HALT_GRAPH]();
	let frame = clampFrame(fromFrame, 0, engine.playbackDurationFrames);
	if (isPlaybackLoopEnabled(engine) && (frame < engine.loop.startFrame || frame >= engine.loop.endFrame)) frame = engine.loop.startFrame;
	const nodes: AudioNode[] = [];
	const sources = new Set<AudioScheduledSourceNode>();
	const source = addNode(nodes, context.createBufferSource());
	if (!prepared.audioBuffer) {
		prepared.audioBuffer = context.createBuffer(prepared.channels.length, prepared.frameCount, prepared.sampleRate);
		for (let channel = 0; channel < prepared.channels.length; channel += 1) {
			if (typeof prepared.audioBuffer.copyToChannel === 'function') {
				prepared.audioBuffer.copyToChannel(
					prepared.channels[channel] as Float32Array<ArrayBuffer>,
					channel,
				);
			} else prepared.audioBuffer.getChannelData(channel).set(prepared.channels[channel]);
		}
	}
	const smallLoop = smallSilentLoopBody(engine, context, prepared);
	source.buffer = smallLoop ?? prepared.audioBuffer;
	let masterAnalyser = null;
	const playbackDestination = playbackOutputDestination(
		engine, context, soundscaperNativeAudioDestination(context, context.destination),
	);
	const meterDestination = engine.masterLoudnessMeter?.node || playbackDestination;
	if (engine.meterListeners.size > 0) {
		masterAnalyser = createAnalyser(context, nodes);
		connect(source, masterAnalyser);
		connect(masterAnalyser, meterDestination);
	} else connect(source, meterDestination);
	const outputFrameAt = (timelineFrame: number) => prepared.durationFrames > 0
		? clampFrame(Math.round(timelineFrame / prepared.durationFrames * prepared.frameCount), 0, prepared.frameCount)
		: 0;
	if (smallLoop) {
		source.loop = true; source.loopStart = 0;
		source.loopEnd = (engine.loop.endFrame - engine.loop.startFrame) / (engine.sampleRate * engine.playbackRate);
	} else if (isPlaybackLoopEnabled(engine) && engine.loop.endFrame > engine.loop.startFrame && engine.loop.endFrame <= prepared.durationFrames) {
		source.loop = true;
		source.loopStart = outputFrameAt(engine.loop.startFrame) / prepared.sampleRate;
		source.loopEnd = outputFrameAt(engine.loop.endFrame) / prepared.sampleRate;
	}
	engine.playEndFrame = Math.max(frame, isPlaybackLoopEnabled(engine)
		? engine.loop.endFrame
		: playRangeStopFrame(engine.playRange, frame, engine.playbackDurationFrames));
	engine.playbackStartFrame = frame;
	engine.positionFrame = frame;
	engine.loopScheduleTime = Number.POSITIVE_INFINITY;
	engine.graph = {
		nodes,
		sources,
		abortController: new AbortController(),
		trackInputs: new Map(),
		trackGainParams: new Map(),
		projectGainParams: {
			tracks: new Map(),
			groups: new Map(),
			sends: new Map(),
			master: null,
		},
		parameterRegistry: new ScheduledParameterRegistry(),
		trackAnalysers: new Map(),
		groupAnalysers: new Map(),
		sendAnalysers: new Map(),
		masterAnalyser,
		effectNodes: new Map(),
		effectAnalysers: new Map(),
		effectMessageSequences: new Map(),
		latencyFrames: 0,
	};
	const graph = engine.graph;
	try {
		scheduledTime = Math.max(scheduledTime, context.currentTime + minimumStartLeadSeconds);
		if (onBeforeStart) scheduledTime = await confirmClockedPlaybackStart(context, scheduledTime, onBeforeStart);
		if (engine.graph !== graph || graph.abortController.signal.aborted) {
			throw new DOMException('Playback cancelled', 'AbortError');
		}
		engine.playbackStartTime = scheduledTime;
		if (!smallLoop && isPlaybackLoopEnabled(engine) && engine.loop.endFrame > prepared.durationFrames) {
			engine.loopScheduleTime = scheduledTime + (engine.loop.endFrame - frame) / (engine.sampleRate * engine.playbackRate);
		}
		source.start(scheduledTime, smallLoop ? (frame - engine.loop.startFrame) / (engine.sampleRate * engine.playbackRate)
			: outputFrameAt(frame) / prepared.sampleRate);
		sources.add(source);
	} catch (error) {
		if (engine.graph === graph) engine[ENGINE_HALT_GRAPH]();
		throw error;
	}
	engine[ENGINE_SET_STATE]('playing');
	engine.masterLoudnessMeter?.setRunning(!engine.loudnessMeasurementManuallyPaused);
	engine[ENGINE_START_TICKER]();
	engine[ENGINE_EMIT_POSITION]();
	return scheduledTime;
}

/** Sample-scale loops need native looping; copying at most4096 frames stays bounded at32channels. */
function smallSilentLoopBody(engine: EngineRuntimeHost, context: AudioContext,
	prepared: NonNullable<EngineRuntimeHost['preparedSpeedPlayback']>): AudioBuffer | null {
	if (!isPlaybackLoopEnabled(engine) || engine.loop.endFrame <= prepared.durationFrames) return null;
	const seconds = (engine.loop.endFrame - engine.loop.startFrame) / (engine.sampleRate * engine.playbackRate);
	const frames = Math.ceil(seconds * prepared.sampleRate);
	if (frames < 1 || frames > 4096) return null;
	const buffer = context.createBuffer(prepared.channels.length, frames, prepared.sampleRate);
	const first = Math.round(engine.loop.startFrame / Math.max(1, prepared.durationFrames) * prepared.frameCount);
	for (let channel = 0; channel < prepared.channels.length; channel++) {
		buffer.getChannelData(channel).set(prepared.channels[channel]!.subarray(first, first + frames));
	}
	return buffer;
}

/** Repeat the shared PCM body on the loop clock; unoccupied timeline stays implicit silence. */
export function scheduleSilentPreparedLoopAhead(engine: EngineRuntimeHost): void {
	const { graph, context, preparedSpeedPlayback: prepared } = engine;
	if (!graph || !context || !prepared?.audioBuffer || engine.loop.endFrame <= prepared.durationFrames) return;
	const duration = (engine.loop.endFrame - engine.loop.startFrame) / (engine.sampleRate * engine.playbackRate);
	if (!(duration > 0)) return;
	const horizon = context.currentTime + Math.max(.25, engine.meterInterval / 1000 * 4);
	if (engine.loopScheduleTime < context.currentTime) engine.loopScheduleTime +=
		Math.ceil((context.currentTime - engine.loopScheduleTime) / duration) * duration;
	let iterations = 0;
	while (engine.loopScheduleTime < horizon && iterations++ < 1024) {
		if (engine.loop.startFrame < prepared.durationFrames) {
			const transient = getTransientNodes(graph.nodes);
			const source = addNode(transient, context.createBufferSource());
			source.buffer = prepared.audioBuffer;
			connect(source, graph.masterAnalyser || engine.masterLoudnessMeter?.node || playbackOutputDestination(
				engine, context, soundscaperNativeAudioDestination(context, context.destination)));
			const offset = Math.round(engine.loop.startFrame / prepared.durationFrames * prepared.frameCount);
			source.onended = () => { graph.sources.delete(source); releaseTransientNodes(transient, [source]); };
			source.start(engine.loopScheduleTime, offset / prepared.sampleRate);
			graph.sources.add(source);
		}
		engine.loopScheduleTime += duration;
	}
}
