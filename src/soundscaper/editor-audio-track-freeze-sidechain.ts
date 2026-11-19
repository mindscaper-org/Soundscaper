/* SPDX-License-Identifier: AGPL-3.0-only */

import { dataArray, dataRecord, type DataRecord } from './editor-audio-track-freeze-values.ts';

/** The isolated freeze renderer has no sidechain source, so only inactive keys may remain. */
export function hasSoundscaperFreezeSidechain(project: DataRecord, track: DataRecord): boolean {
	if (track.effectsActive === false) return false;
	const active = new Set(dataArray(track.effects, 'audio freeze track.effects')
		.filter(effect => effect.enabled !== false && effect.bypassed !== true).map(effect => effect.id));
	if (active.size === 0) return false;
	const mixer = dataRecord(project.mixer, 'project.mixer');
	return dataArray(mixer.edges, 'project.mixer.edges').some(edge => {
		if (edge.enabled === false) return false;
		const destination = dataRecord(edge.destination, 'mixer edge destination');
		if (destination.kind !== 'effect-sidechain' || !active.has(destination.effectId)) return false;
		const strip = dataRecord(destination.strip, 'sidechain destination strip');
		return strip.kind === 'track' && strip.id === track.id;
	});
}

export function assertSoundscaperFreezeHasNoSidechain(project: DataRecord, track: DataRecord): void {
	if (hasSoundscaperFreezeSidechain(project, track)) {
		throw new Error(`Audio track ${String(track.id)} has an effect keyed by a sidechain, which a freeze cannot render.`);
	}
}
