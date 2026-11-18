/* SPDX-License-Identifier: AGPL-3.0-only */
import { aafHex, type AafObject, type AafObjectTable } from './aaf-object-table.ts';
import { timelineImportIssue, type TimelineInterchangeClip, type TimelineInterchangeAutomation } from './timeline-interchange-types.ts';
import type { DeliveryReportItem } from './delivery-report.ts';
import { interchangeMissingEffect } from './interchange-effect-state.ts';
import { addRationals, multiplyRationals, roundRational, type Rational } from './timeline-time.ts';

const GAIN = new Set(['94a82e9d6809d3118a380050040ef7d2', '95a82e9d6809d3118a380050040ef7d2']);
const PAN = '93a82e9d6809d3118a380050040ef7d2';
const DISSOLVE = '41ea3b0c05fcd2118a290050040ef7d2', TWO_DISSOLVE = '90bd1123dab58542aa3a8552848779b3';
const AMPLITUDE = '212396e46722d3118a4c0050040ef7d2', PAN_VALUE = '222396e46722d3118a4c0050040ef7d2';
const LEVEL = '202396e46722d3118a4c0050040ef7d2', OUTGOING = '0700619ee21be141bb11c95de9964d03', INCOMING = '42a6ce48f9a85b4582b386c814b797c7';
const LINEAR = 'a4856c5bde0ed31180a9006008143e6f', CONSTANT = 'a5856c5bde0ed31180a9006008143e6f';

export interface AafImportCurve { readonly points: readonly Readonly<{ time: number; value: number }>[]; readonly hold: boolean }
export function aafOperationId(object: AafObject): string { return aafHex(object.properties.get(0x0b01)?.data.subarray(-16) ?? new Uint8Array()); }

/** AAF's vendor operations have no portable executable rack contract. Keep their parameter records inert. */
export function aafMissingOperation(file: AafObjectTable, object: AafObject, id: string) {
	const snapshot = (node: AafObject) => ({ classCode: node.classCode, properties: [...node.properties].map(([pid, property]) => ({ pid, format: property.format, data: aafHex(property.data) })) });
	return interchangeMissingEffect('aaf', id, `AAF operation ${aafOperationId(object)}`, { operation: snapshot(object),
		parameters: file.refs(object, 0x0b03).map(parameter => ({ ...snapshot(parameter), points: file.refs(parameter, 0x4e02).map(snapshot) })) });
}

export function aafOperationCurve(file: AafObjectTable, object: AafObject, issues: DeliveryReportItem[]) {
	const op = aafOperationId(object), parameterId = GAIN.has(op) ? AMPLITUDE : op === PAN ? PAN_VALUE : null;
	if (!parameterId) return null;
	const parameter = file.refs(object, 0x0b03).find(param => aafHex(param.properties.get(0x4c01)?.data ?? new Uint8Array()) === parameterId);
	if (!parameter) return null;
	return { kind: op === PAN ? 'pan' as const : 'gain' as const, curve: readCurve(file, parameter, issues) };
}

export function aafDissolveCurves(file: AafObjectTable, transition: AafObject, issues: DeliveryReportItem[]) {
	const group = file.ref(transition, 0x1801);
	if (!group) return null;
	const op = aafOperationId(group);
	if (op !== DISSOLVE && op !== TWO_DISSOLVE) return null;
	const parameters = file.refs(group, 0x0b03);
	const read = (id: string) => {
		const parameter = parameters.find(param => aafHex(param.properties.get(0x4c01)?.data ?? new Uint8Array()) === id);
		return parameter ? readCurve(file, parameter, issues) : null;
	};
	if (op === TWO_DISSOLVE) {
		const outgoing = read(OUTGOING), incoming = read(INCOMING);
		return outgoing && incoming ? { outgoing, incoming } : null;
	}
	const incoming = read(LEVEL) ?? { points: [{ time: 0, value: 0 }, { time: 1, value: 1 }], hold: false };
	return { incoming, outgoing: { ...incoming, points: incoming.points.map(point => ({ ...point, value: 1 - point.value })) } };
}

export function aafPanAutomation(curve: AafImportCurve, start: Rational, duration: Rational, sampleRate: number): TimelineInterchangeAutomation {
	return { parameter: 'pan', points: curve.points.map(point => ({ frame: Math.round((seconds(start) + point.time * seconds(duration)) * sampleRate),
		value: point.value * 2 - 1, interpolation: curve.hold ? 'hold' : 'linear' })) };
}

/** Multiply clip envelopes with operation/fade curves, retaining breakpoints and bounded product error. */
export function aafApplyClipGain(clip: TimelineInterchangeClip, curve: AafImportCurve, start: Rational, duration: Rational,
	sampleRate: number, issues?: DeliveryReportItem[]): TimelineInterchangeClip {
	const toFrame = (time: Rational) => {
		const frame = multiplyRationals(time, sampleRate);
		return roundRational(frame.num, frame.den, 'point');
	};
	const clipStart = toFrame(clip.start);
	const operationStart = toFrame(start);
	const frames = toFrame(addRationals(clip.start, clip.duration)) - clipStart;
	const offset = clipStart - operationStart;
	const extent = toFrame(addRationals(start, duration)) - operationStart;
	if (extent <= 0) return clip;
	const positions = new Set([0, frames, ...(clip.envelope ?? []).map(point => point.frame)]);
	for (const point of curve.points) {
		const frame = Math.round(point.time * extent - offset);
		if (frame >= 0 && frame <= frames) positions.add(frame);
		if (curve.hold && frame > 0 && frame <= frames) positions.add(frame - 1);
	}
	let clamped = false;
	const valueAt = (frame: number) => {
		const local = (frame + offset) / extent;
		const gain = local < 0 || local > 1 ? 1 : evaluate(curve, local);
		const envelope = clip.envelope?.length ? evaluate({ points: clip.envelope.map(point => ({ time: point.frame, value: point.value })), hold: false }, frame) : 1;
		const product = gain * envelope, bounded = Math.max(0, Math.min(16, product));
		if (bounded !== product) clamped = true; return bounded;
	};
	const sorted = [...positions].sort((a, b) => a - b), output = new Map(sorted.map(frame => [frame, valueAt(frame)]));
	const subdivide = (a: number, b: number): void => {
		if (b - a <= 1) return;
		const av = valueAt(a), bv = valueAt(b), middle = a + Math.floor((b - a) / 2);
		if ([.25, .5, .75].every(t => { const frame = Math.round(a + (b - a) * t); return Math.abs(valueAt(frame) - (av + (bv - av) * (frame - a) / (b - a))) <= 1e-5; })) return;
		if (output.size >= 100_000) throw new RangeError('AAF gain envelope exceeds its point budget.');
		output.set(middle, valueAt(middle)); subdivide(a, middle); subdivide(middle, b);
	};
	for (let index = 1; index < sorted.length; index++) subdivide(sorted[index - 1]!, sorted[index]!);
	if (clamped) issues?.push(timelineImportIssue('aaf', 'envelope-gain-clamped', 'Composed gain is limited to the clip envelope range.', 'converted'));
	return { ...clip, envelope: [...output].sort(([a], [b]) => a - b).map(([frame, value]) => ({ frame, value })) };
}

function readCurve(file: AafObjectTable, parameter: AafObject, issues: DeliveryReportItem[]): AafImportCurve {
	if (parameter.classCode === 0x3d) return { points: [{ time: 0, value: indirect(parameter, 0x4d01) }], hold: true };
	if (parameter.classCode !== 0x3e) throw new TypeError('Unsupported AAF parameter record.');
	const interpolation = aafHex(parameter.properties.get(0x4e01)?.data.subarray(-16) ?? new Uint8Array());
	if (interpolation !== LINEAR && interpolation !== CONSTANT) issues.push(timelineImportIssue('aaf', 'interpolation-converted', 'An unsupported AAF interpolator is converted to linear control points.', 'converted', { interpolation }));
	const points = file.refs(parameter, 0x4e02).map(point => ({ time: rational(point.properties.get(0x1a03)?.data), value: indirect(point, 0x1a02) })).sort((a, b) => a.time - b.time);
	if (!points.length || points.some((point, index) => point.time < 0 || point.time > 1 || index > 0 && point.time <= points[index - 1]!.time)) throw new RangeError('Invalid AAF automation control point positions.');
	return { points, hold: interpolation === CONSTANT };
}
function indirect(object: AafObject, pid: number): number {
	const bytes = object.properties.get(pid)?.data;
	if (bytes?.length !== 25 || bytes[0] !== 0x4c || aafHex(bytes.subarray(1, 17)) !== '0001010300000000060e2b3401040101') throw new TypeError('AAF audio automation requires rational indirect values.');
	return rational(bytes.subarray(17));
}
function rational(bytes: Uint8Array | undefined): number {
	if (bytes?.length !== 8) throw new TypeError('Invalid AAF automation rational.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), denominator = view.getInt32(4, true);
	if (denominator <= 0) throw new RangeError('Invalid AAF automation denominator.');
	return view.getInt32(0, true) / denominator;
}
function seconds(value: Rational): number { return value.num / value.den; }
function evaluate(curve: AafImportCurve, time: number): number {
	const first = curve.points[0]!;
	if (time <= first.time) return first.value;
	for (let index = 1; index < curve.points.length; index++) {
		const a = curve.points[index - 1]!, b = curve.points[index]!;
		if (time < b.time) return curve.hold ? a.value : a.value + (b.value - a.value) * (time - a.time) / (b.time - a.time);
	}
	return curve.points.at(-1)!.value;
}
