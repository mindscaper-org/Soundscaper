/* SPDX-License-Identifier: AGPL-3.0-only */

import { addNode, connect, type AudioNodeArray } from './audio-node-utils.ts';
import { activeRackEffects } from './project-effects.ts';
import { applyEffectRack, type EffectRackOptions } from './effect-rack.ts';
import type { EngineProject } from './types.ts';
import { compileClipEffectLatencyPlan, type ClipEffectLatencyPlan } from './clip-effect-latency-plan.ts';
import { delayAudioNodeFrames } from './frame-delay.ts';

/** A namespace separate from persisted track IDs in the scheduler's input map. */
export function clipEffectInputKey(id: unknown): string {
	return `clip-effect:${JSON.stringify(id)}`;
}

/** All source paths enter the mixer with the same clip-processing latency. */
export function projectClipEffectLatencyFrames(project: EngineProject, sampleRate: number): number {
	return compileClipEffectLatencyPlan(project, sampleRate).maximumLatencyFrames;
}

/** Build once per clip, shared by loop repeats, warp segments and chunk sources. */
export function buildClipEffectInputs(context: BaseAudioContext, project: EngineProject, plan: ClipEffectLatencyPlan,
	trackInputs: Map<string, AudioNode>, nodes: AudioNodeArray, options: EffectRackOptions, onlyTrackId: unknown = null): void {
	const { clips, maximumLatencyFrames: maximumLatency } = plan;
	if (![...plan.clipPlans.keys()].some(id => activeRackEffects(clips.get(id)).some(effect => effect.enabled !== false && effect.bypassed !== true))) return;
	const widths = new Map((project.sources ?? []).map(source => [source.id, source.channelCount ?? 2]));
	const detectorInputs = new Map<string, AudioNode>();
	for (const track of project.tracks ?? []) {
		const destination = trackInputs.get(String(track.id));
		if (!destination || track.type === 'video' || track.type === 'label') continue;
		const input = addNode(nodes, context.createGain()); detectorInputs.set(String(track.id), input);
		connect(delayAudioNodeFrames(context, input, maximumLatency - (plan.trackLatencyFrames.get(String(track.id)) ?? 0), nodes), destination);
	}
	for (const track of project.tracks ?? []) {
		if (onlyTrackId != null && String(track.id) !== String(onlyTrackId)) continue;
		const destination = detectorInputs.get(String(track.id));
		if (!destination || track.type === 'video' || track.type === 'label') continue;
		for (const id of track.clipIds ?? []) {
			const clip = clips.get(id);
			if (!clip || clip.kind !== 'audio') continue;
			const effects = activeRackEffects(clip);
			if (!effects.length && maximumLatency === 0 && !plan.controlTracks.has(String(track.id))) continue;
			const input = addNode(nodes, context.createGain());
			const width = widths.get(clip.sourceId) ?? 2;
			const latency = plan.clipPlans.get(String(id))!;
			const output = applyEffectRack(context, input, effects, nodes, { ...options,
				scope: 'clip', targetId: id, sidechainInputs: detectorInputs, effectChannelCount: width, parametricEqChannelCount: width,
				inputDelayFramesByEffectId: latency.inputDelays, detectorDelayFramesByEffectId: latency.detectorDelays });
			connect(delayAudioNodeFrames(context, output, (plan.trackLatencyFrames.get(String(track.id)) ?? 0) - latency.latencyFrames, nodes), destination);
			trackInputs.set(clipEffectInputKey(id), input);
		}
	}
}
