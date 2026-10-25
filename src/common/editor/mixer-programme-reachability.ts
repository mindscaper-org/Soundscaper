/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerSignalTopologyV21 } from './mixer-signal-topology-v21.ts';

/** One directed traversal from all seeds, with no per-query graph searches. */
function closure(seeds: Iterable<string>, successors: (key: string) => readonly string[]): Set<string> {
	const seen = new Set(seeds), pending = [...seen];
	for (let cursor = 0; cursor < pending.length; cursor++) {
		for (const next of successors(pending[cursor]!)) if (!seen.has(next)) {
			seen.add(next);
			pending.push(next);
		}
	}
	return seen;
}

function predecessors(topology: MixerSignalTopologyV21, seeds: Iterable<string>, allowed: (from: string, to: string) => boolean): Map<string, string[]> {
	const reverse = new Map<string, string[]>();
	const seen = new Set(seeds), pending = [...seen];
	for (let cursor = 0; cursor < pending.length; cursor++) {
		const key = pending[cursor]!;
		for (const next of topology.successors(key)) {
			if (!seen.has(next)) { seen.add(next); pending.push(next); }
			if (!allowed(key, next)) continue;
			const previous = reverse.get(next);
			if (previous) previous.push(key);
			else reverse.set(next, [key]);
		}
	}
	return reverse;
}

export function soloRelatedStrips(topology: MixerSignalTopologyV21, stripKeys: Iterable<string>, soloed: readonly string[]): ReadonlySet<string> {
	const reverse = predecessors(topology, stripKeys, () => true);
	return new Set([...closure(soloed, key => topology.successors(key)), ...closure(soloed, key => reverse.get(key) ?? [])]);
}

export function programmeReachableStrips(topology: MixerSignalTopologyV21, stripKeys: Iterable<string>, outputs: ReadonlySet<string>, allowed: (from: string, to: string) => boolean): ReadonlySet<string> {
	const reverse = predecessors(topology, [...stripKeys, ...outputs], allowed);
	return closure(outputs, key => reverse.get(key) ?? []);
}
