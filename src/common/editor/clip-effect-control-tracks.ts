/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineClip, EngineTrack } from './engine/types.ts';

/** Retain external detector/MIDI inputs when a render narrows the programme. */
export function clipEffectControlTrackIds(project: Readonly<{
	clips?: readonly EngineClip[]; tracks?: readonly EngineTrack[];
}>, trackIds: ReadonlySet<string>): string[] {
	const tracks = new Map(project.tracks?.map(track => [String(track.id), track]));
	const clips = new Map(project.clips?.map(clip => [clip.id, clip]));
	const visited = new Set<string>();
	const pending = [...trackIds];
	const controls = new Set<string>();
	for (let index = 0; index < pending.length; index++) {
		const trackId = pending[index]!;
		if (visited.has(trackId)) continue;
		visited.add(trackId);
		for (const clipId of tracks.get(trackId)?.clipIds ?? []) {
			const clip = clips.get(clipId);
			if (!clip || clip.effectsActive === false) continue;
			for (const effect of clip.effects ?? []) {
				if (effect.enabled === false || effect.bypassed === true) continue;
				const id = effect.type === 'auto-tune' ? effect.params?.controlTrackId
					: effect.type === 'audacity-auto-duck' ? effect.context?.controlTrackId : null;
				if (typeof id === 'string' && id && !controls.has(id)) {
					controls.add(id);
					pending.push(id);
				}
			}
		}
	}
	return [...controls];
}
