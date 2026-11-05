/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileTempo } from './midi-file-types.ts';
import { resolveAllegroTempoClock } from './allegro-file-tempo-clock.ts';

export interface AllegroTempoDeclaration extends MidiFileTempo { readonly order: number; readonly beat?: number }
export interface AllegroBeatAnchor { readonly frame: number; readonly beat: number; readonly order: number }

/** Explicit-time anchors describe one global clock, regardless of their line order. */
export function allegroTempoDeclarations(tempos: readonly AllegroTempoDeclaration[],
	anchors: readonly AllegroBeatAnchor[], sampleRate: number): MidiFileTempo[] {
	if (!anchors.length) return resolveAllegroTempoClock(tempos, sampleRate);
	// A repeated time replaces that anchor, matching the source parser's insertion.
	const ordered = [...new Map(anchors.map(anchor => [anchor.frame, anchor])).values()]
		.sort((left, right) => left.frame - right.frame);
	let previous = { frame: 0, beat: 0 };
	for (const anchor of ordered) {
		if (anchor.frame === 0 && anchor.beat === 0) continue;
		if (anchor.frame <= previous.frame || anchor.beat <= previous.beat) {
			throw new RangeError('Allegro beat anchors must increase in time and beat.');
		}
		previous = anchor;
	}
	const declarations = [...tempos.map(tempo => ({ ...tempo, kind: 'tempo' as const })),
		...ordered.map(anchor => ({ ...anchor, kind: 'anchor' as const }))].sort((left, right) => left.order - right.order);
	let latestTempo = -Infinity, latestAnchor = -Infinity;
	for (const declaration of declarations) {
		if (declaration.kind === 'tempo') {
			if (declaration.frame < Math.max(latestTempo, latestAnchor)) throw new RangeError('Retroactive mixed Allegro clock mutations cannot be retained. Use chronological conductor declarations.');
			latestTempo = declaration.frame;
		} else {
			if (declaration.frame < latestTempo) throw new RangeError('Retroactive mixed Allegro clock mutations cannot be retained. Use chronological conductor declarations.');
			latestAnchor = Math.max(latestAnchor, declaration.frame);
		}
	}
	declarations.sort((left, right) => left.frame - right.frame || left.order - right.order);
	const nodes = [{ frame: 0, beat: 0, bpm: 100 }];
	let explicitTempo: number | undefined;
	for (const declaration of declarations) {
		const prior = nodes.at(-1)!;
		const beat = declaration.kind === 'anchor' ? declaration.beat
			: prior.beat + (declaration.frame - prior.frame) / sampleRate * prior.bpm / 60;
		if (declaration.kind === 'anchor') {
			// A tempo declaration already established an interior clock node.
			// The anchor stretches only the interval after that node.
			const incoming = declaration.frame === prior.frame ? nodes.at(-2) : prior;
			if (incoming) {
				if (beat <= incoming.beat) throw new RangeError('Allegro beat anchors must increase in time and beat.');
				incoming.bpm = (beat - incoming.beat) / (declaration.frame - incoming.frame) * sampleRate * 60;
			}
		} else explicitTempo = declaration.bpm;
		const node = { frame: declaration.frame, beat, bpm: explicitTempo ?? prior.bpm };
		if (node.frame === prior.frame) nodes[nodes.length - 1] = node;
		else nodes.push(node);
	}
	return nodes.map(({ frame, bpm }) => ({ frame, bpm }));
}
