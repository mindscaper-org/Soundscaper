/* SPDX-License-Identifier: AGPL-3.0-only */

export interface DawprojectRoutingIndex<Strip> {
	readonly groups: ReadonlyMap<string, Strip>;
	readonly nodes: ReadonlyMap<string, Strip>;
	readonly sends: ReadonlySet<string>;
}

/** One export owns these indexes over its already normalized routing snapshot. */
export function indexDawprojectRouting<Strip extends { readonly id: string }>(routing: {
	readonly groups: readonly Strip[]; readonly sends: readonly Strip[];
}): DawprojectRoutingIndex<Strip> {
	const groups = new Map<string, Strip>();
	const nodes = new Map<string, Strip>();
	const sends = new Set<string>();
	for (const strip of routing.groups) {
		if (!groups.has(strip.id)) groups.set(strip.id, strip);
		if (!nodes.has(strip.id)) nodes.set(strip.id, strip);
	}
	for (const strip of routing.sends) {
		sends.add(strip.id);
		if (!nodes.has(strip.id)) nodes.set(strip.id, strip);
	}
	return { groups, nodes, sends };
}
