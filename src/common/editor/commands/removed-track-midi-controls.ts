/* SPDX-License-Identifier: AGPL-3.0-only */

import { updateEffect } from '../effects.js';
import { retainedClipEffectRacks } from './retained-clip-effect-racks.ts';

/** Losing a MIDI guide must not stop the remaining programme or silently select another scale. */
export function retireRemovedMidiControls(project: unknown, removed: ReadonlySet<string>): void {
	const root = record(project), mixer = record(root?.mixer);
	const owners = [root?.master, ...array(root?.tracks), ...array(mixer?.groups), ...array(mixer?.sends), ...array(mixer?.cues)];
	const racks = retainedClipEffectRacks(project);
	for (const owner of owners) {
		const effects = record(owner)?.effects;
		if (effects !== undefined) racks.push(effects);
	}
	for (const value of racks) {
		if (!Array.isArray(value)) continue;
		const rack: unknown[] = value;
		for (const [index, candidate] of rack.entries()) {
			const effect = record(candidate), params = record(effect?.params), control = params?.controlTrackId;
			if (effect?.type !== 'auto-tune' || typeof control !== 'string' || !removed.has(control)) continue;
			rack[index] = updateEffect(effect, { enabled: false, params: { controlTrackId: '' } });
		}
	}
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}
function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
