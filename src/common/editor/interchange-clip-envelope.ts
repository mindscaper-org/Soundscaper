/* SPDX-License-Identifier: AGPL-3.0-only */
import { interchangeAutomationLane, type InterchangeAutomationPoint } from './interchange-automation.ts';
import { evaluateAutomationLaneAtFrameV21 } from './automation-lane-v21.ts';

/** Legacy clip envelopes are linear; encode held discontinuities at adjacent samples. */
export function interchangeClipEnvelope(points: readonly InterchangeAutomationPoint[], duration: number,
	convert: (value: number) => number = value => value, onClamped?: () => void): readonly Readonly<{ frame: number; value: number }>[] {
	let ordinal = 0;
	const lane = interchangeAutomationLane(points, { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' }, () => `envelope-${++ordinal}`,
		value => { const authored = convert(value), bounded = Math.max(0, Math.min(16, authored)); if (authored !== bounded) onClamped?.(); return bounded; });
	if (!lane) return [];
	const output = new Map<number, number>();
	for (const frame of [0, duration]) output.set(frame, evaluateAutomationLaneAtFrameV21(lane, frame, { sampleRate: 48000 })!);
	for (const [index, point] of lane.points.entries()) {
		const frame = Number(point.position);
		if (frame >= 0 && frame <= duration) output.set(frame, point.value);
		const next = Number(lane.points[index + 1]?.position);
		if (lane.segments[index]?.kind === 'hold' && next > frame && next <= duration) output.set(next - 1, point.value);
	}
	return [...output].sort(([a], [b]) => a - b).map(([frame, value]) => ({ frame, value }));
}
