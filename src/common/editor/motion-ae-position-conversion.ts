/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeProperty } from './motion-ae-exchange-types.ts';
import { convertMotionAeNumericProperty, type MotionAeNumericConversion } from './motion-ae-property-conversion.ts';
import type { MotionScalarProperty } from './motion-property.ts';
import type { Rational } from './timeline-time.ts';

/** A null result leaves an active combined Position to the ordinary transform converter. */
export function convertMotionAeSeparatedPosition(properties: readonly MotionAeProperty[], frameRate: Rational, activeRange: readonly [number, number]): MotionAeNumericConversion | null {
	const leaders = properties.filter(property => property.matchName === 'ADBE Position'), leader = leaders[0];
	const followers = properties.filter(property => property.matchName.startsWith('ADBE Position_'));
	if (!followers.length && !leaders.some(property => property.kind === 'numeric' && property.dimensionsSeparated === true)) return null;
	const unsupported = (message: string): MotionAeNumericConversion => ({ status: 'unsupported', property: null, quantizedClock: false, message });
	if (leaders.length !== 1 || leader?.kind !== 'numeric' || leader.dimensionsSeparated === undefined) return unsupported('Separated Position requires exactly one numeric leader with captured separation state. Inactive combined coordinates are not used.');
	if (!leader.dimensionsSeparated) return null;
	const dimensions = leader.value.length;
	if (![2, 3].includes(dimensions) || followers.length !== dimensions) return unsupported('Separated Position requires every active axis exactly once; incomplete channels remain in the original exchange.');
	const values: MotionScalarProperty[] = []; let sampled = false, quantizedClock = false;
	for (let axis = 0; axis < dimensions; axis++) {
		const candidates = followers.filter(property => property.matchName === `ADBE Position_${String(axis)}`), source = candidates[0];
		if (candidates.length !== 1 || source?.kind !== 'numeric' || source.spatial || source.value.length !== 1) return unsupported('Separated Position requires unique numeric scalar axis channels.');
		if (source.samples) {
			const samples = source.samples, begin = samples.firstFrame / samples.frameRate, end = (samples.firstFrame + samples.values.length - 1) / samples.frameRate;
			if (begin > activeRange[0] || end < activeRange[1]) return unsupported('Separated Position samples do not cover the active composition range. Export complete samples or render the composition.');
		}
		const converted = convertMotionAeNumericProperty(source, { frameRate, axes: [0], defaults: [0], scale: 1 });
		if (converted.property?.kind !== 'scalar') return unsupported(converted.message);
		values.push(converted.property); sampled ||= converted.status === 'sampled'; quantizedClock ||= converted.quantizedClock;
	}
	return { status: sampled ? 'sampled' : 'editable', quantizedClock,
		property: { kind: 'vector3', value: [values[0]!.value, values[1]!.value, values[2]?.value ?? 0],
			curves: [values[0]!.curve, values[1]!.curve, values[2]?.curve ?? null], expression: null },
		message: sampled ? 'Separated Position frame samples became independent linear Motion axis curves; subframe motion requires rendered fallback.'
			: 'Separated Position axes retain independent authored hold/linear curves. Inactive combined values and keys stay in the original exchange.' };
}
