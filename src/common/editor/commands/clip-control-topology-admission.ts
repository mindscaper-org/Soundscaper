/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../i18n/presentation-message.ts';
import { assertAcyclicRoutingV21 } from '../routing-cycle-v21.ts';
import type { EngineProject } from '../engine/types.ts';
import type { AudioEditorCommand } from './protocol.ts';

/** Clip rack outputs feed track inputs, so an implicit detector can close a real audio loop. */
export function createClipControlTopologyAdmission(base: unknown) {
	let changed = false;
	return {
		beforeCommand(_project: unknown, command: AudioEditorCommand): void {
			if (command.type === 'clip/update' && command.changes.effectsActive !== true) return;
			if (command.type === 'track/update') return;
			if (command.type === 'effect/update' && command.changes.context === undefined
				&& command.changes.enabled !== true && command.changes.bypassed !== false && command.changes.type === undefined) return;
			changed ||= /^(?:effect|clip|track|range|clipboard|project-bin|take-comp|audio-freeze|edit|punch)\//u.test(command.type);
		},
		afterCommand(_project: unknown): void {},
		assertPersistedResult(result: unknown): void {
			if (!changed) return;
			const next = controlGraph(result);
			if (!next.size) return;
			const previous = controlGraph(base);
			// Preserve passive imported state and permit removals that repair it.
			if (![...next].some(([owner, controls]) => [...controls].some(id => !previous.get(owner)?.has(id)))) return;
			try { assertAcyclicRoutingV21(next.keys(), next, 'Clip detector feedback cycle.'); }
			catch {
				throw createLocalizedError(RangeError, {}, 'autoDuckOtherControlTrack', undefined,
					{ fallback: 'Auto Duck requires another audio control track without a feedback cycle.' });
			}
		},
	};
}

function controlGraph(value: unknown): Map<string, Set<string>> {
	const project = value as EngineProject;
	const clips = new Map(project.clips?.map(clip => [clip.id, clip]));
	const graph = new Map<string, Set<string>>();
	for (const track of project.tracks ?? []) {
		if (track.type !== 'audio') continue;
		const controls = new Set<string>();
		for (const id of track.clipIds ?? []) {
			const clip = clips.get(id);
			if (!clip || clip.effectsActive === false) continue;
			for (const effect of clip.effects ?? []) {
				if (effect.type !== 'audacity-auto-duck' || effect.enabled === false || effect.bypassed === true) continue;
				const control = effect.context?.controlTrackId;
				if (typeof control === 'string' && control) controls.add(control);
			}
		}
		if (controls.size) graph.set(String(track.id), controls);
	}
	return graph;
}
