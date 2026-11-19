/* SPDX-License-Identifier: AGPL-3.0-only */
import { AEP_LIMITS, aepChild, aepText, aepView, type AepChunk } from './aep-container.ts';
import { aepFinite } from './aep-project-reader.ts';
import type { InterpolationShape, CompiledInterpolationCurve } from './interpolation-curve.ts';
import { motionAeBoundedClock } from './motion-bounded-clock.ts';
export interface AepNumericKey {
	readonly time: number; readonly value: readonly number[]; readonly incoming: number; readonly outgoing: number; readonly roving: boolean;
	readonly inSpeed: readonly number[]; readonly outSpeed: readonly number[]; readonly inInfluence: readonly number[]; readonly outInfluence: readonly number[];
	readonly inTangent: readonly number[]; readonly outTangent: readonly number[];
}
export interface AepNumeric { readonly value: readonly number[]; readonly keys: readonly AepNumericKey[]; readonly expression: string | null; readonly expressionEnabled: boolean; readonly spatial: boolean }
export interface AepReadBudget { keys: number }
export function readAepNumeric(chunk: AepChunk | undefined, budget: AepReadBudget, readDefault = false): AepNumeric | null {
	if (!chunk) return null;
	if (chunk.type !== 'tdbs') throw new TypeError('AEP numeric property has an unsupported record type.');
	const state = aepChild(chunk, 'tdsb');
	if (!readDefault && state && aepView(state.data, 4).getUint32(0) === 3) return null;
	const raw = aepChild(chunk, 'tdb4'); if (!raw) throw new TypeError('AEP numeric property header is missing.');
	const header = aepView(raw.data, 124), dimensions = raw.data[3]!;
	if (header.getUint16(0) !== 0xdb99 || dimensions < 1 || dimensions > 4) throw new TypeError('AEP numeric property layout is unsupported.');
	const scale = header.getUint32(12); if (!scale) throw new RangeError('AEP property time scale is zero.');
	const expressionBytes = aepChild(chunk, 'Utf8'), expression = expressionBytes ? aepText(expressionBytes.data) : null;
	if (expression !== null && expression.length > 65_536) throw new RangeError('AEP expression custody exceeds its text budget.');
	const list = aepChild(chunk, 'list'), keys: AepNumericKey[] = [];
	let spatial = Boolean(raw.data[7]);
	if (list) {
		const listHeader = aepChild(list, 'lhd3'), data = aepChild(list, 'ldat');
		if (!listHeader) throw new TypeError('AEP key list header is missing.');
		const meta = aepView(listHeader.data, 52), count = meta.getUint32(8), size = meta.getUint32(16);
		if (meta.getUint32(0) !== 0xd00bee || count > 4096 || (budget.keys += count) > AEP_LIMITS.keys) throw new RangeError('AEP key list exceeds its format or count budget.');
		if (count && (!data || data.data.length !== count * size)) throw new RangeError('AEP key list size is inconsistent.');
		const spatialSize = 56 + dimensions * 24, plainSize = 8 + dimensions * 40;
		if (size === spatialSize && size !== plainSize) spatial = true;
		else if (size === plainSize && size !== spatialSize) spatial = false;
		if (size !== (spatial ? spatialSize : plainSize)) throw new TypeError('AEP numeric key template is unsupported.');
		for (let index = 0; index < count; index++) {
			const record = aepView(data!.data.subarray(index * size, (index + 1) * size), size);
			const numbers = (at: number, length: number) => Array.from({ length }, (_, axis) => aepFinite(record.getFloat64(at + axis * 8)));
			const values = numbers(spatial ? 56 : 8, dimensions), ease = 8 + dimensions * 8;
			keys.push({ time: record.getInt32(0) / scale, value: values, incoming: record.getUint8(4), outgoing: record.getUint8(5), roving: Boolean(record.getUint16(6) & 32),
				inSpeed: spatial ? numbers(24, 1) : numbers(ease, dimensions), inInfluence: spatial ? numbers(32, 1) : numbers(ease + dimensions * 8, dimensions),
				outSpeed: spatial ? numbers(40, 1) : numbers(ease + dimensions * 16, dimensions), outInfluence: spatial ? numbers(48, 1) : numbers(ease + dimensions * 24, dimensions),
				inTangent: spatial ? numbers(56 + dimensions * 8, dimensions) : [], outTangent: spatial ? numbers(56 + dimensions * 16, dimensions) : [] });
		}
	}
	const data = aepChild(chunk, 'cdat'), value = data ? Array.from({ length: dimensions }, (_, axis) => aepFinite(aepView(data.data, dimensions * 8).getFloat64(axis * 8))) : keys[0]?.value;
	if (!value) throw new TypeError('AEP numeric value is missing.');
	return { value, keys, expression, expressionEnabled: expression !== null && raw.data[119] !== 1, spatial };
}

/** Temporal ease is mapped in composition frames; spatial curves need a separate path/speed mapping. */
export function aepNumericCurve(property: AepNumeric, axis: number, units: number, clock: Readonly<{ start: number; stretch: number; rate: number }>): CompiledInterpolationCurve | null {
	if (!property.keys.length) return null;
	if (property.keys.some(key => key.roving || [...key.inTangent, ...key.outTangent].some(value => value !== 0))) throw new TypeError('Spatial tangents and roving keys are retained in the original AEP; this curve requires a separate mapping.');
	const reverse = clock.stretch < 0;
	if (reverse && property.keys.some(key => key.incoming === 3 || key.outgoing === 3)) throw new TypeError('Reverse hold discontinuities require a separate native animation mapping.');
	const keys = property.keys.map(key => ({ ...key, frame: (clock.start + key.time * clock.stretch) * clock.rate,
		incoming: reverse ? key.outgoing : key.incoming, outgoing: reverse ? key.incoming : key.outgoing,
		inSpeed: reverse ? key.outSpeed : key.inSpeed, outSpeed: reverse ? key.inSpeed : key.outSpeed,
		inInfluence: reverse ? key.outInfluence : key.inInfluence, outInfluence: reverse ? key.inInfluence : key.outInfluence })).sort((a, b) => a.frame - b.frame);
	const anchors = keys.map(key => ({ position: motionAeBoundedClock(key.frame).value, value: key.value[axis]! * units }));
	const segments: InterpolationShape[] = [];
	for (let index = 0; index < keys.length - 1; index++) {
		const left = keys[index]!, right = keys[index + 1]!, a = anchors[index]!, b = anchors[index + 1]!;
		if (left.frame >= right.frame) throw new RangeError('AEP key times collide after retiming.');
		if (left.outgoing === 3) { segments.push({ kind: 'hold' }); continue; }
		if (![1, 2, 3].includes(left.outgoing) || ![1, 2, 3].includes(right.incoming)) throw new TypeError('AEP key interpolation is unknown.');
		if (left.outgoing !== 2 && right.incoming !== 2) { segments.push({ kind: 'linear' }); continue; }
		if (property.spatial) throw new TypeError('Spatial Bezier speed requires a separate native path mapping.');
		const duration = right.frame - left.frame, axisIndex = property.spatial ? 0 : axis;
		const out = left.outgoing === 2 ? left.outInfluence[axisIndex]! : 1 / 6, incoming = right.incoming === 2 ? right.inInfluence[axisIndex]! : 1 / 6;
		if (out < 0.001 || out > 1 || incoming < 0.001 || incoming > 1) throw new RangeError('AEP temporal influence is outside the supported range.');
		const slope = (b.value - a.value) / duration;
		const outSpeed = left.outgoing === 2 ? left.outSpeed[axisIndex]! * units / clock.stretch / clock.rate : slope;
		const inSpeed = right.incoming === 2 ? right.inSpeed[axisIndex]! * units / clock.stretch / clock.rate : slope;
		segments.push({ kind: 'bezier', control1: { position: motionAeBoundedClock(left.frame + duration * out).value, value: a.value + outSpeed * duration * out },
			control2: { position: motionAeBoundedClock(right.frame - duration * incoming).value, value: b.value - inSpeed * duration * incoming } });
	}
	const resultAnchors = [anchors[0]!], resultSegments: InterpolationShape[] = [];
	for (let index = 0; index < segments.length; index++) {
		const shape = segments[index]!, a = anchors[index]!, b = anchors[index + 1]!;
		if (shape.kind === 'bezier' && shape.control1.position.num / shape.control1.position.den > shape.control2.position.num / shape.control2.position.den) {
			// Subdivide the same parametric cubic. Motion's monotone-control contract remains intact.
			const midpoint = (p: typeof a, q: typeof a) => ({ position: motionAeBoundedClock((p.position.num / p.position.den + q.position.num / q.position.den) / 2).value, value: (p.value + q.value) / 2 });
			const ab = midpoint(a, shape.control1), bc = midpoint(shape.control1, shape.control2), cd = midpoint(shape.control2, b);
			const left = midpoint(ab, bc), right = midpoint(bc, cd), middle = midpoint(left, right);
			resultSegments.push({ kind: 'bezier', control1: ab, control2: left }, { kind: 'bezier', control1: right, control2: cd });
			resultAnchors.push(middle, b);
		} else { resultSegments.push(shape); resultAnchors.push(b); }
	}
	return { anchors: resultAnchors, segments: resultSegments };
}
