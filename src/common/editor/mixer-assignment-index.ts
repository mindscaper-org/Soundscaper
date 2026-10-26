/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerEdgeV21 } from './mixer-graph-v21.ts';

/** Raw typed graphs can still contain getters; admit only inert assignment fields. */
export function mixerAssignmentIndex(edges: readonly MixerEdgeV21[]): ReadonlySet<string> | null {
	if (Object.getPrototypeOf(edges) !== Array.prototype
		|| Object.hasOwn(edges, 'some') || Object.hasOwn(edges, Symbol.iterator)) return null;
	const keys = new Set<string>();
	for (let index = 0; index < edges.length; index++) {
		const slot = Object.getOwnPropertyDescriptor(edges, String(index));
		if (!slot || !Object.hasOwn(slot, 'value')) return null;
		const edge = slot.value as unknown;
		if (!inert(edge, ['enabled', 'kind', 'source', 'destination'])) return null;
		const source = edge.source, destination = edge.destination;
		if (!inert(source, ['kind', 'id']) || !inert(destination, ['kind', 'id'])) return null;
		if (typeof edge.enabled !== 'boolean' || typeof edge.kind !== 'string'
			|| typeof source.kind !== 'string' || typeof destination.kind !== 'string'
			|| (source.id !== undefined && typeof source.id !== 'string')
			|| (destination.id !== undefined && typeof destination.id !== 'string')) return null;
		if (edge.enabled && edge.kind === 'assignment' && destination.kind === 'mixer-node') {
			keys.add(assignmentKey(source.kind, source.id as string, destination.id as string));
		}
	}
	return keys;
}

export function assignmentKey(kind: string, source: string, destination: string): string {
	return JSON.stringify([kind, source, destination]);
}

function inert(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) return false;
	return fields.every(field => {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		return descriptor ? Object.hasOwn(descriptor, 'value') : !(field in value);
	});
}
