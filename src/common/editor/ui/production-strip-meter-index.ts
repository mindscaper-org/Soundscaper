/* SPDX-License-Identifier: AGPL-3.0-only */
import type { StripMeterSnapshot } from '../production-audio/strip-meter-session.ts';

interface MeterIndex {
	readonly master?: StripMeterSnapshot;
	readonly tracks: ReadonlyMap<string, StripMeterSnapshot>;
	readonly nodes: ReadonlyMap<string, StripMeterSnapshot>;
}
// Telemetry owns at most 128 strips. Keep one weak publication, never a history of ticks.
const MAXIMUM_INDEXED_STRIPS = 128;
const indexes = new WeakMap<readonly StripMeterSnapshot[], MeterIndex>();
let currentOwner: WeakRef<readonly StripMeterSnapshot[]> | undefined;

export function productionStripMeterIndex(meters: readonly StripMeterSnapshot[]): MeterIndex | null {
	const retained = indexes.get(meters);
	if (retained) return retained;
	if (meters.length > MAXIMUM_INDEXED_STRIPS || !Object.isFrozen(meters)
		|| Object.getPrototypeOf(meters) !== Array.prototype || Object.hasOwn(meters, Symbol.iterator)) return null;
	const tracks = new Map<string, StripMeterSnapshot>();
	const nodes = new Map<string, StripMeterSnapshot>();
	let master: StripMeterSnapshot | undefined;
	for (let i = 0; i < meters.length; i++) {
		const descriptor = Object.getOwnPropertyDescriptor(meters, i);
		if (!descriptor || !('value' in descriptor)) return null;
		const meter = descriptor.value as StripMeterSnapshot | null;
		if (!meter || !Object.isFrozen(meter)) return null;
		const strip = dataField(meter, 'strip');
		if (!strip || typeof strip !== 'object' || !Object.isFrozen(strip)) return null;
		const kind = dataField(strip, 'kind');
		if (kind === 'master') { master ??= meter; continue; }
		const id = dataField(strip, 'id');
		if ((kind !== 'track' && kind !== 'mixer-node') || typeof id !== 'string') return null;
		const entries = kind === 'track' ? tracks : nodes;
		if (!entries.has(id)) entries.set(id, meter);
	}
	const previous = currentOwner?.deref();
	if (previous) indexes.delete(previous);
	const index: MeterIndex = { master, tracks, nodes };
	indexes.set(meters, index);
	currentOwner = new WeakRef(meters);
	return index;
}
function dataField(owner: object, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(owner, field);
	return descriptor && 'value' in descriptor ? descriptor.value as unknown : undefined;
}
