/* SPDX-License-Identifier: AGPL-3.0-only */

import { createIndexedBeatFrameProjector } from './indexed-tempo-projector.ts';
import { createSampleFrameBeatProjector } from './timeline-tempo-inverse.ts';
import type { HoldTempoMap, Rational, RationalInput } from './timeline-time.ts';

export interface CommandTempoProjection {
	baseFrame(beat: RationalInput): number;
	draftBeat(frame: number): Rational;
}

/** One synchronous reconciliation owns distinct persisted and edited tempo facts. */
export function createCommandTempoProjection(base: HoldTempoMap, draft: HoldTempoMap, sampleRate: number): CommandTempoProjection {
	let forward: ReturnType<typeof createIndexedBeatFrameProjector> | undefined;
	let inverse: ReturnType<typeof createSampleFrameBeatProjector> | undefined;
	return {
		baseFrame: beat => (forward ??= createIndexedBeatFrameProjector(base, sampleRate))(beat),
		draftBeat: frame => (inverse ??= createSampleFrameBeatProjector(draft, sampleRate))(frame),
	};
}
