/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneV21 } from '../../automation-lane-v21.ts';
import type { ParameterDescriptor } from '../../parameter-address.ts';

/** Straight curves need anchors only; musical curves keep authoritative dense sampling. */
export function automationSampleFrames(options: Readonly<{
	lane: AutomationLaneV21 | null;
	descriptor: ParameterDescriptor;
	start: number;
	end: number;
	step: number;
	authoredFrames: readonly number[];
	pixelsPerFrame: number;
	yAtFrame: (frame: number) => number;
}>): number[] {
	const boundaries = [...new Set([options.start, ...options.authoredFrames, options.end])].sort((a, b) => a - b);
	const lane = options.lane;
	if (!lane || lane.points.length < 2 || lane.segments.every(segment => segment.kind === 'hold'
		|| (segment.kind === 'linear' && lane.timebase === 'absolute-samples' && options.descriptor.taper === 'linear'))) return boundaries;
	if (lane.timebase !== 'absolute-samples') {
		const frames = [...boundaries];
		for (let value = options.start + options.step; value < options.end; value += options.step) frames.push(value);
		return [...new Set(frames)].sort((a, b) => a - b);
	}
	const result = new Set(boundaries);
	const ys = new Map<number, number>();
	const y = (frame: number) => {
		let value = ys.get(frame);
		if (value === undefined) { value = options.yAtFrame(frame); ys.set(frame, value); }
		return value;
	};
	const visit = (start: number, end: number, depth: number) => {
		if (end - start <= options.step || depth >= 24) return;
		const span = end - start;
		const yStart = y(start), yEnd = y(end);
		let flat = true;
		for (let quarter = 1; quarter <= 3; quarter++) {
			const frame = Math.round(start + span * (quarter / 4));
			if (!(Math.abs(y(frame) - (yStart + (yEnd - yStart) * (frame - start) / span)) <= 0.125)) { flat = false; break; }
		}
		if (flat && (end - start) * options.pixelsPerFrame <= 64) return;
		const middle = Math.round(start + span * 0.5);
		if (middle <= start || middle >= end) return;
		result.add(middle);
		visit(start, middle, depth + 1); visit(middle, end, depth + 1);
	};
	for (let index = 1; index < boundaries.length; index += 1) visit(boundaries[index - 1]!, boundaries[index]!, 0);
	return [...result].sort((a, b) => a - b);
}
