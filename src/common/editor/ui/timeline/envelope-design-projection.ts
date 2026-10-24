/* SPDX-License-Identifier: AGPL-3.0-only */

import { envelopeFramesToDesignPoints } from '../../automation.js';

type Envelope = readonly Readonly<{ frame?: number; value?: number }>[];
export interface EnvelopeDesignPoint { readonly time: number; readonly db: number; }
interface Projection {
	readonly id: number;
	readonly envelope: WeakRef<Envelope>;
	readonly sampleRate: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly points: readonly EnvelopeDesignPoint[];
	readonly weight: number;
}
interface OwnerCache {
	readonly byEnvelope: WeakMap<Envelope, Projection>;
	readonly recent: Map<number, Projection>;
	retainedPoints: number;
	nextId: number;
}

export const MAXIMUM_ENVELOPE_PROJECTION_POINTS = 65_536;
export const MAXIMUM_ENVELOPE_PROJECTION_ENTRIES = 256;
const owners = new WeakMap<object, OwnerCache>();

/**
 * The workspace waveform cache owns a bounded set of immutable display points.
 * Raw envelopes stay weak, including any opaque metadata carried by their points.
 * TrackNew paints these points read-only; its envelope editor copies before edits.
 */
export function projectTimelineEnvelopeDesignPoints(
	owner: object | null | undefined, envelope: Envelope | undefined, sampleRate: number,
	{ startFrame, endFrame }: Readonly<{ startFrame: number; endFrame: number }>,
): readonly EnvelopeDesignPoint[] {
	let cache = owner ? owners.get(owner) : undefined;
	const previous = envelope && cache?.byEnvelope.get(envelope);
	if (previous && Object.is(previous.sampleRate, sampleRate)
		&& Object.is(previous.startFrame, startFrame) && Object.is(previous.endFrame, endFrame)) {
		cache!.recent.delete(previous.id);
		cache!.recent.set(previous.id, previous);
		return previous.points;
	}
	const projected: EnvelopeDesignPoint[] = envelopeFramesToDesignPoints(envelope, sampleRate, { startFrame, endFrame });
	if (previous && cache) remove(cache, previous);
	if (!owner || !validScalars(sampleRate, startFrame, endFrame)
		|| !frozenDataEnvelope(envelope) || envelope.length + projected.length > MAXIMUM_ENVELOPE_PROJECTION_POINTS) return projected;
	if (!cache) {
		cache = { byEnvelope: new WeakMap(), recent: new Map(), retainedPoints: 0, nextId: 0 };
		owners.set(owner, cache);
	}
	for (const point of projected) Object.freeze(point);
	const entry: Projection = {
		id: cache.nextId++, envelope: new WeakRef(envelope), sampleRate, startFrame, endFrame,
		points: Object.freeze(projected), weight: envelope.length + projected.length,
	};
	cache.byEnvelope.set(envelope, entry); cache.recent.set(entry.id, entry); cache.retainedPoints += entry.weight;
	while (cache.retainedPoints > MAXIMUM_ENVELOPE_PROJECTION_POINTS || cache.recent.size > MAXIMUM_ENVELOPE_PROJECTION_ENTRIES) {
		const oldest = cache.recent.values().next().value;
		if (!oldest) break;
		remove(cache, oldest);
	}
	return entry.points;
}

function remove(cache: OwnerCache, entry: Projection): void {
	if (!cache.recent.delete(entry.id)) return;
	cache.retainedPoints -= entry.weight;
	const envelope = entry.envelope.deref();
	if (envelope) cache.byEnvelope.delete(envelope);
}

function validScalars(sampleRate: number, start: number, end: number): boolean {
	return typeof sampleRate === 'number' && Number.isFinite(sampleRate) && sampleRate > 0
		&& typeof start === 'number' && Number.isFinite(start) && start >= 0
		&& typeof end === 'number' && (end === Infinity || Number.isFinite(end) && end >= 0);
}

function frozenDataEnvelope(envelope: Envelope | undefined): envelope is Envelope {
	if (!Array.isArray(envelope) || !Object.isFrozen(envelope) || Object.getPrototypeOf(envelope) !== Array.prototype
		|| Object.hasOwn(envelope, 'filter') || Object.hasOwn(envelope, 'constructor')) return false;
	for (let index = 0; index < envelope.length; index++) {
		const slot = Object.getOwnPropertyDescriptor(envelope, String(index));
		if (!slot || !Object.hasOwn(slot, 'value')) return false;
		const point: unknown = slot.value;
		if (!point || typeof point !== 'object' || !Object.isFrozen(point)) return false;
		for (const field of ['frame', 'value']) {
			const descriptor = Object.getOwnPropertyDescriptor(point, field);
			const value: unknown = descriptor?.value;
			if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
		}
	}
	return true;
}
