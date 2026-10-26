/* SPDX-License-Identifier: AGPL-3.0-only */

/** Initial ranks and enabled predecessor order belong to one layout invocation. */
export function routingLayoutRanks(initial: ReadonlyMap<string, number>, predecessors: ReadonlyMap<string, readonly string[]>, maximumPasses: number): ReadonlyMap<string, number> {
	const outgoing = new Map<string, string[]>();
	const incoming = new Map<string, number>();
	for (const key of initial.keys()) incoming.set(key, 0);
	for (const [destination, sources] of predecessors) for (const source of sources) {
		const destinations = outgoing.get(source);
		if (destinations) destinations.push(destination);
		else outgoing.set(source, [destination]);
		incoming.set(destination, (incoming.get(destination) ?? 0) + 1);
		if (!incoming.has(source)) incoming.set(source, 0);
	}
	const queue: string[] = [];
	for (const [key, count] of incoming) if (count === 0) queue.push(key);
	const ordered = new Map(initial);
	for (let cursor = 0; cursor < queue.length; cursor++) {
		const source = queue[cursor]!;
		for (const destination of outgoing.get(source) ?? []) {
			ordered.set(destination, Math.max(ordered.get(destination) ?? 0, (ordered.get(source) ?? 0) + 1));
			const remaining = (incoming.get(destination) ?? 0) - 1;
			incoming.set(destination, remaining);
			if (remaining === 0) queue.push(destination);
		}
	}
	if (queue.length === incoming.size) return ordered;
	// Unvalidated cyclic graphs keep the historical bounded relaxation result.
	const rank = new Map(initial);
	for (let pass = 0; pass < maximumPasses; pass++) {
		let changed = false;
		for (const [destination, sources] of predecessors) for (const source of sources) {
			const candidate = (rank.get(source) ?? 0) + 1;
			if (candidate > (rank.get(destination) ?? 0)) { rank.set(destination, candidate); changed = true; }
		}
		if (!changed) break;
	}
	return rank;
}
