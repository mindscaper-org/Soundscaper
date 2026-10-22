/* SPDX-License-Identifier: AGPL-3.0-only */

import { attribute, booleanAttribute, childElement, integerAttribute, numberAttribute, type XmlElement } from './dawproject-xml.ts';
import type { DawprojectAutomationEvent, DawprojectAutomationPoint, DawprojectTimeResolver } from './dawproject-import-timeline.ts';

interface TimedPoint extends DawprojectAutomationPoint { readonly time: number }

/** Flatten point clocks without moving a beat-linear segment across tempo steps. */
export function readDawprojectAutomationPoints(element: XmlElement, options: Readonly<{
	trackId: string | null; frameAt(time: number): number; originBeat: number;
	beatTimebase: boolean; resolver: DawprojectTimeResolver;
}>): DawprojectAutomationEvent | null {
	const target = childElement(element, 'Target');
	let kind: 'real' | 'bool' = 'real';
	const points: TimedPoint[] = [];
	for (const point of element.children) {
		const time = point.name === 'Target' ? null : numberAttribute(point, 'time');
		if (time === null || !Number.isFinite(time)) continue;
		const frame = options.frameAt(time);
		if (point.name === 'RealPoint') {
			const value = numberAttribute(point, 'value');
			if (value !== null) points.push({ time, frame, value, interpolation: attribute(point, 'interpolation') === 'linear' ? 'linear' : 'hold' });
		} else if (point.name === 'BoolPoint') {
			kind = 'bool'; points.push({ time, frame, value: booleanAttribute(point, 'value') === true ? 1 : 0, interpolation: 'hold' });
		} else if (point.name === 'IntegerPoint' || point.name === 'EnumPoint') {
			const value = integerAttribute(point, 'value');
			if (value !== null) points.push({ time, frame, value, interpolation: 'hold' });
		}
	}
	if (!points.length) return null;
	points.sort((left, right) => left.time - right.time);
	const flattened: DawprojectAutomationPoint[] = [];
	for (const [index, point] of points.entries()) {
		flattened.push({ frame: point.frame, value: point.value, interpolation: point.interpolation });
		const next = points[index + 1];
		if (!options.beatTimebase || point.interpolation !== 'linear' || !next || next.time <= point.time
			|| !Number.isFinite(point.value) || !Number.isFinite(next.value)) continue;
		for (const beat of options.resolver.tempoChangeBeats ?? []) {
			const time = beat - options.originBeat;
			if (time <= point.time || time >= next.time) continue;
			flattened.push({ frame: options.resolver.frameAtBeat(beat), interpolation: 'linear',
				value: point.value + (next.value - point.value) * (time - point.time) / (next.time - point.time) });
		}
	}
	return Object.freeze({ trackId: options.trackId, parameterId: target ? attribute(target, 'parameter') : null,
		unit: attribute(element, 'unit'), kind, points: Object.freeze(flattened) });
}
