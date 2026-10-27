/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CommandTempoProjection } from './project-command-tempo-projection.ts';

type DataRecord = Record<string, unknown>;

/** Preserve musical label authority while reconciling one resolved command draft. */
export function conformMusicalLabels(draft: DataRecord, persistedBase: DataRecord, timing: CommandTempoProjection): void {
	const baseLabels = new Map<string, DataRecord>();
	for (const track of recordArray(persistedBase.tracks, 'project.tracks')) {
		for (const label of track.type === 'label' ? recordArray(track.labels, 'track.labels') : []) {
			baseLabels.set(JSON.stringify([track.id, label.id]), label);
		}
	}
	for (const track of recordArray(draft.tracks, 'project.tracks')) {
		if (track.type !== 'label') continue;
		for (const label of recordArray(track.labels, 'track.labels')) {
			if (label.anchor !== 'musical') continue;
			const base = baseLabels.get(JSON.stringify([track.id, label.id]));
			if (!base && label.startFrame === undefined && label.endFrame === undefined) continue;
			const start = nonNegativeSafeInteger(label.startFrame, 'label.startFrame');
			const end = nonNegativeSafeInteger(label.endFrame, 'label.endFrame');
			const baseStart = base?.anchor === 'musical'
				? timing.baseFrame(base.startBeat as { num: number; den: number })
				: null;
			const baseEnd = base?.anchor === 'musical'
				? timing.baseFrame(base.endBeat as { num: number; den: number })
				: null;
			if (baseStart === null || start !== baseStart) label.startBeat = timing.draftBeat(start);
			if (baseEnd === null || end !== baseEnd) label.endBeat = timing.draftBeat(end);
			delete label.startFrame;
			delete label.endFrame;
			delete label.coordinateDomain;
		}
	}
}


function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item: unknown) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${name} must be an object.`);
		return item as DataRecord;
	});
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}
