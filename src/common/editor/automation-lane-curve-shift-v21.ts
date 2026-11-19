/* SPDX-License-Identifier: AGPL-3.0-only */
import { AUTOMATION_LANE_MAXIMUM_POINTS_V21, type AutomationLaneFrameOptionsV21, type AutomationLaneTimebaseV21 } from './automation-lane-v21.ts';
import { createIndexedBeatFrameProjector } from './indexed-tempo-projector.ts';
import { addFractions, compareFractions, divideFractions, exactFraction, integerFraction, multiplyFractions, publicFraction, subtractFractions, type ExactInterpolationFraction } from './interpolation-curve-math.ts';
import type { InterpolationShape } from './interpolation-curve.ts';

export interface EditableAutomationPointV21 {
	readonly id: string;
	readonly position: ExactInterpolationFraction;
	readonly value: number;
}
export interface EditableAutomationCurveV21 {
	readonly points: readonly EditableAutomationPointV21[];
	readonly segments: readonly InterpolationShape[];
}
interface ClockEvent {
	readonly beat: ExactInterpolationFraction;
	readonly frame: ExactInterpolationFraction;
	readonly samplesPerBeat: ExactInterpolationFraction;
}

/** Preserve sample displacement, including each change in either side's held tempo. */
export function shiftAutomationLaneCurveV21(curve: EditableAutomationCurveV21, timebase: AutomationLaneTimebaseV21,
	deltaFrames: number, options: AutomationLaneFrameOptionsV21, mint: (tag: string) => string,
	split: (curve: EditableAutomationCurveV21, frame: number, id: string) => EditableAutomationCurveV21,
): EditableAutomationCurveV21 {
	const delta = integerFraction(deltaFrames);
	if (deltaFrames === 0) return curve;
	if (timebase === 'absolute-samples') return mapCurve(curve, position => addFractions(position, delta));
	if (!options.tempoMap) throw new TypeError('Musical automation requires a tempo map.');
	const project = createIndexedBeatFrameProjector(options.tempoMap, options.sampleRate, { requireExact: true });
	const facts: ClockEvent[] = options.tempoMap.events.map(event => ({
		beat: exactFraction(event.beat), frame: integerFraction(project(event.beat)),
		samplesPerBeat: divideFractions(integerFraction(60 * options.sampleRate), exactFraction(event.bpm)),
	}));
	const toFrame = (beat: ExactInterpolationFraction): ExactInterpolationFraction => {
		const event = active(facts, beat, 'beat');
		return addFractions(event.frame, multiplyFractions(subtractFractions(beat, event.beat), event.samplesPerBeat));
	};
	const toBeat = (frame: ExactInterpolationFraction): ExactInterpolationFraction => {
		const event = active(facts, frame, 'frame');
		return addFractions(event.beat, divideFractions(subtractFractions(frame, event.frame), event.samplesPerBeat));
	};
	const first = toFrame(curve.points[0]!.position), last = toFrame(curve.points.at(-1)!.position);
	const boundaries = new Set(facts.slice(1).flatMap(event => [Number(event.frame.numerator), Number(event.frame.numerator) - deltaFrames]));
	for (const frame of [...boundaries].sort((left, right) => left - right)) {
		const position = integerFraction(frame);
		if (compareFractions(position, first) <= 0 || compareFractions(position, last) >= 0) continue;
		const beat = toBeat(position);
		if (curve.points.some(point => compareFractions(point.position, beat) === 0)) continue;
		if (curve.points.length >= AUTOMATION_LANE_MAXIMUM_POINTS_V21) throw new RangeError('An automation interval edit cannot exceed the 4096-point lane cap.');
		curve = split(curve, frame, mint(`tempo-shift-${String(frame)}`));
	}
	return mapCurve(curve, position => toBeat(addFractions(toFrame(position), delta)));
}

function active(events: readonly ClockEvent[], position: ExactInterpolationFraction, key: 'beat' | 'frame'): ClockEvent {
	let lower = 1, upper = events.length;
	while (lower < upper) {
		const middle = (lower + upper) >>> 1;
		if (compareFractions(events[middle]![key], position) <= 0) lower = middle + 1; else upper = middle;
	}
	return events[lower - 1]!;
}

function mapCurve(curve: EditableAutomationCurveV21, map: (position: ExactInterpolationFraction) => ExactInterpolationFraction): EditableAutomationCurveV21 {
	return {
		points: curve.points.map(point => ({ ...point, position: map(point.position) })),
		segments: curve.segments.map(segment => segment.kind !== 'bezier' ? segment : ({
			...segment,
			control1: { ...segment.control1, position: publicFraction(map(exactFraction(segment.control1.position))) },
			control2: { ...segment.control2, position: publicFraction(map(exactFraction(segment.control2.position))) },
		})),
	};
}
