/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../../src/common/editor/code-unit-order.ts';
import { nonNegativeFrame, positiveFrame } from '../../src/common/editor/aup4-export-values.js';

interface Clip { readonly id: unknown; readonly timelineStartFrame: unknown; readonly durationFrames: unknown }

/** Frozen pre-R06 production kernel; timing comparator, not the independent parity oracle. */
export function legacyOverlapLanes(clips: readonly Clip[]): unknown[][] {
	const lanes: unknown[][] = [];
	const laneEnds: number[] = [];
	for (const clip of clips.slice().sort((left, right) => (
		Number(left.timelineStartFrame) - Number(right.timelineStartFrame)
		|| compareCodeUnits(String(left.id), String(right.id))
	))) {
		const start = nonNegativeFrame(clip.timelineStartFrame, `clip ${clip.id as string} timelineStartFrame`);
		const end = start + positiveFrame(clip.durationFrames, `clip ${clip.id as string} durationFrames`);
		let laneIndex = laneEnds.findIndex(laneEnd => laneEnd <= start);
		if (laneIndex < 0) {
			laneIndex = lanes.length;
			lanes.push([]);
			laneEnds.push(0);
		}
		lanes[laneIndex]!.push(clip.id);
		laneEnds[laneIndex] = end;
	}
	return lanes.length ? lanes : [[]];
}
