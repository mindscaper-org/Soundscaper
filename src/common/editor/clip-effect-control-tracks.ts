/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineClip, EngineTrack } from './engine/types.ts';

/** Retain external detector/MIDI inputs when a render narrows the programme. */
export function clipEffectControlTrackIds(project: Readonly<{
	clips?: readonly EngineClip[]; tracks?: readonly EngineTrack[];
}>, trackIds: ReadonlySet<string>): string[] {
	const ids = new Set(project.tracks?.filter(track => trackIds.has(String(track.id))).flatMap(track => track.clipIds ?? []));
	const controls = new Set<string>();
	for (const clip of project.clips ?? []) {
		if (!ids.has(clip.id) || clip.effectsActive === false) continue;
		for (const effect of clip.effects ?? []) {
			if (effect.enabled === false || effect.bypassed === true) continue;
			const id = effect.type === 'auto-tune' ? effect.params?.controlTrackId
				: effect.type === 'audacity-auto-duck' ? effect.context?.controlTrackId : null;
			if (typeof id === 'string' && id) controls.add(id);
		}
	}
	return [...controls];
}
