/* SPDX-License-Identifier: AGPL-3.0-only */

import { splitAutomationLaneAtFrameV21 } from './automation-lane-interval-edit-v21.ts';
import { createAutomationLaneBoundaryIdMinterV21 } from './automation-lane-interval-boundary-id-v21.ts';
import { resolveAutomationLanePointFramesV21, type AutomationLaneFrameOptionsV21,
	type AutomationLanePointV21, type AutomationLaneV21 } from './automation-lane-v21.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import { compareRationals } from './timeline-time.ts';

/** Keep the original curve through the neighbouring programme samples before
 * replacing a recorded interval. The final merge owns the persisted point cap;
 * this bounded staging curve may temporarily carry two additional guards.
 */
export function guardAutomationCaptureBoundariesV21(
	lane: AutomationLaneV21,
	captured: readonly Readonly<AutomationLanePointV21>[],
	frameOptions?: AutomationLaneFrameOptionsV21,
): AutomationLaneV21 {
	const first = captured[0], last = captured.at(-1);
	if (!first || !last) return lane;
	if (lane.timebase === 'musical-beats' && !frameOptions?.tempoMap) {
		throw new TypeError('Musical automation capture requires its authoritative sample clock and tempo map.');
	}
	// Absolute positions are already samples, so their guard geometry is rate independent.
	const options = frameOptions ?? { sampleRate: 48_000 };
	const endpoints = first === last ? [first] : [first, last];
	const frames = resolveAutomationLanePointFramesV21({ ...lane, points: endpoints,
		segments: first === last ? [] : [{ kind: 'linear' }] }, options);
	const startFrame = frames[0]!.frame, endFrame = frames.at(-1)!.frame;
	if (!Number.isSafeInteger(endFrame + 1)) throw new RangeError('Automation capture has no representable following sample.');
	const mint = createAutomationLaneBoundaryIdMinterV21(lane.id, {
		startFrame, endFrame, insertedDurationFrames: endFrame - startFrame,
	}, [...lane.points, ...captured].map(point => point.id));
	const prefix = startFrame > 0 ? insertUnchangedBoundary(lane, startFrame - 1, mint('capture-before'), options) : lane;
	return insertUnchangedBoundary(prefix, endFrame + 1, mint('capture-after'), options);
}

function insertUnchangedBoundary(
	lane: AutomationLaneV21, frame: number, id: string, options: AutomationLaneFrameOptionsV21,
): AutomationLaneV21 {
	const position = lane.timebase === 'absolute-samples' ? frame
		: sampleFrameToBeat(frame, options.tempoMap!, options.sampleRate);
	let index = lane.points.findIndex(point => compareRationals(point.position, position) >= 0);
	if (index >= 0 && compareRationals(lane.points[index]!.position, position) === 0) return lane;
	if (index === 0) return { ...lane,
		points: [{ id, position, value: lane.points[0]!.value }, ...lane.points],
		segments: [{ kind: 'hold' }, ...lane.segments] };
	if (index < 0) return { ...lane,
		points: [...lane.points, { id, position, value: lane.points.at(-1)!.value }],
		segments: [...lane.segments, { kind: 'hold' }] };
	index -= 1;
	// Split only the crossing segment, so even a full persisted lane need not
	// admit a 4097-point intermediate document merely to discard its interior.
	const split = splitAutomationLaneAtFrameV21({ ...lane,
		points: lane.points.slice(index, index + 2), segments: [lane.segments[index]!] }, frame, id, options);
	return { ...lane,
		points: [...lane.points.slice(0, index + 1), split.points[1]!, ...lane.points.slice(index + 1)],
		segments: [...lane.segments.slice(0, index), ...split.segments, ...lane.segments.slice(index + 1)] };
}
