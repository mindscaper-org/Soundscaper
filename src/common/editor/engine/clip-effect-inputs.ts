/* SPDX-License-Identifier: AGPL-3.0-only */

import { addNode, connect, setParam, type AudioNodeArray } from './audio-node-utils.ts';
import { activeRackEffects } from './project-effects.ts';
import { applyEffectRack, effectRackLatencyFrames, type EffectRackOptions } from './effect-rack.ts';
import type { EngineProject } from './types.ts';

/** A namespace separate from persisted track IDs in the scheduler's input map. */
export function clipEffectInputKey(id: unknown): string {
	return `clip-effect:${JSON.stringify(id)}`;
}

/** All source paths enter the mixer with the same clip-processing latency. */
export function projectClipEffectLatencyFrames(project: EngineProject, sampleRate: number): number {
	const mounted = new Set(project.tracks?.flatMap(track => track.clipIds ?? []) ?? []);
	return (project.clips ?? []).reduce((maximum, clip) => clip.kind === 'audio' && mounted.has(clip.id)
		? Math.max(maximum, effectRackLatencyFrames(activeRackEffects(clip), sampleRate)) : maximum, 0);
}

/** Build once per clip, shared by loop repeats, warp segments and chunk sources. */
export function buildClipEffectInputs(context: BaseAudioContext, project: EngineProject,
	trackInputs: Map<string, AudioNode>, nodes: AudioNodeArray, options: EffectRackOptions, onlyTrackId: unknown = null): void {
	const maximumLatency = projectClipEffectLatencyFrames(project, context.sampleRate);
	const clips = new Map((project.clips ?? []).map(clip => [clip.id, clip]));
	const widths = new Map((project.sources ?? []).map(source => [source.id, source.channelCount ?? 2]));
	for (const track of project.tracks ?? []) {
		if (onlyTrackId != null && String(track.id) !== String(onlyTrackId)) continue;
		const destination = trackInputs.get(String(track.id));
		if (!destination || track.type === 'video' || track.type === 'label') continue;
		for (const id of track.clipIds ?? []) {
			const clip = clips.get(id);
			if (!clip || clip.kind !== 'audio') continue;
			const effects = activeRackEffects(clip);
			if (!effects.length && maximumLatency === 0) continue;
			const input = addNode(nodes, context.createGain());
			const width = widths.get(clip.sourceId) ?? 2;
			let output = applyEffectRack(context, input, effects, nodes, { ...options,
				scope: 'clip', targetId: id, sidechainInputs: trackInputs, effectChannelCount: width, parametricEqChannelCount: width });
			const compensation = maximumLatency - effectRackLatencyFrames(effects, context.sampleRate);
			if (compensation > 0) {
				const seconds = compensation / context.sampleRate;
				const delay = addNode(nodes, context.createDelay(Math.max(1, seconds)));
				setParam(delay.delayTime, seconds, context.currentTime);
				connect(output, delay);
				output = delay;
			}
			connect(output, destination);
			trackInputs.set(clipEffectInputKey(id), input);
		}
	}
}
