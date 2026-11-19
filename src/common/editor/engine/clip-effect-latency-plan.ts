/* SPDX-License-Identifier: AGPL-3.0-only */

import { effectLatencyFrames } from './effect-rack.ts';
import { activeRackEffects } from './project-effects.ts';
import type { EngineEffect, EngineProject, EngineTrack } from './types.ts';

export interface ClipEffectLatency {
	readonly latencyFrames: number;
	readonly inputDelays: ReadonlyMap<string, number>;
	readonly detectorDelays: ReadonlyMap<string, number>;
}
export type ClipEffectLatencyPlan = ReturnType<typeof compileClipEffectLatencyPlan>;
const EMPTY_LATENCY: ClipEffectLatency = { latencyFrames: 0, inputDelays: new Map(), detectorDelays: new Map() };

/** Detector taps precede final mix compensation. Resolve their processing dependencies first. */
export function compileClipEffectLatencyPlan(project: EngineProject, sampleRate: number) {
	const clips = new Map(project.clips?.map(clip => [clip.id, clip]));
	const tracks = new Map<string, EngineTrack>();
	let audioTrackIndex = 0;
	for (const track of project.tracks ?? []) {
		if (track.type === 'video' || track.type === 'label') continue;
		tracks.set(String(track.id ?? audioTrackIndex), track);
		audioTrackIndex++;
	}
	const dependencies = new Map<string, Set<string>>(), dependents = new Map<string, string[]>(), controlTracks = new Set<string>();
	const trackLatencyFrames = new Map<string, number>(), clipPlans = new Map<string, ClipEffectLatency>();
	const pending: string[] = [];
	for (const [id, track] of tracks) {
		const controls = new Set<string>();
		for (const clipId of track.clipIds ?? []) for (const effect of activeRackEffects(clips.get(clipId))) {
			const control = detector(effect);
			if (control && tracks.has(control)) { controls.add(control); controlTracks.add(control); }
		}
		dependencies.set(id, controls);
		if (!controls.size) pending.push(id);
		for (const control of controls) { const targets = dependents.get(control) ?? []; targets.push(id); dependents.set(control, targets); }
	}
	let maximumLatencyFrames = 0;
	for (let index = 0; index < pending.length; index++) {
		const id = pending[index]!, track = tracks.get(id)!;
		let maximum = 0;
		for (const clipId of track.clipIds ?? []) {
			const clip = clips.get(clipId);
			if (clip?.kind !== 'audio') continue;
			const effects = activeRackEffects(clip).filter(effect => effect.enabled !== false && effect.bypassed !== true);
			if (!effects.length) { clipPlans.set(String(clipId), EMPTY_LATENCY); continue; }
			let latency = 0;
			const inputDelays = new Map<string, number>(), detectorDelays = new Map<string, number>();
			for (const effect of effects) {
				const control = detector(effect);
				if (control) {
					const detectorLatency = trackLatencyFrames.get(control) ?? 0, aligned = Math.max(latency, detectorLatency);
					inputDelays.set(String(effect.id), aligned - latency);
					detectorDelays.set(String(effect.id), aligned - detectorLatency);
					latency = aligned;
				}
				latency += effectLatencyFrames(effect, sampleRate);
			}
			clipPlans.set(String(clipId), { latencyFrames: latency, inputDelays, detectorDelays });
			maximum = Math.max(maximum, latency);
		}
		trackLatencyFrames.set(id, maximum);
		maximumLatencyFrames = Math.max(maximumLatencyFrames, maximum);
		for (const target of dependents.get(id) ?? []) {
			const remaining = dependencies.get(target)!; remaining.delete(id);
			if (!remaining.size) pending.push(target);
		}
	}
	if (trackLatencyFrames.size !== tracks.size) throw new RangeError('Clip detector feedback cycle.');
	return { maximumLatencyFrames, trackLatencyFrames, clipPlans, controlTracks, clips };
}

function detector(effect: EngineEffect): string | null {
	const id = effect.type === 'audacity-auto-duck' && effect.enabled !== false && effect.bypassed !== true ? effect.context?.controlTrackId : null;
	return typeof id === 'string' && id ? id : null;
}
