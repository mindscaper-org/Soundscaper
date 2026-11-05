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
	const derived: AllegroTempoDeclaration[] = [];
	let previous = { frame: 0, beat: 0 };
	for (const anchor of ordered) {
		if (anchor.frame === 0 && anchor.beat === 0) continue;
		if (anchor.frame <= previous.frame || anchor.beat <= previous.beat) {
			throw new RangeError('Allegro beat anchors must increase in time and beat.');
		}
		derived.push({ frame: previous.frame, bpm: (anchor.beat - previous.beat) / (anchor.frame - previous.frame) * sampleRate * 60,
			order: anchor.order });
		previous = anchor;
	}
	const result = [...tempos, ...derived].sort((left, right) => left.order - right.order).map(({ frame, bpm }) => ({ frame, bpm }));
	const lastAnchor = ordered.at(-1);
	const tailTempo = tempos.at(-1);
	// A beat anchor fixes the preceding interval. PortSMF retains an explicitly
	// declared final tempo for extrapolation beyond the last anchor.
	if (lastAnchor && tailTempo && tailTempo.frame <= lastAnchor.frame) result.push({ frame: lastAnchor.frame, bpm: tailTempo.bpm });
	return result;
}
