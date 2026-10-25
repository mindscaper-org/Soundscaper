/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerGraphV21 } from './mixer-graph-v21.ts';

function append(index: Map<string, string[]>, from: string, to: string): void {
	const next = index.get(from);
	if (next) next.push(to);
	else index.set(from, [to]);
}

function visit(index: ReadonlyMap<string, readonly string[]>, pending: string[], seen: Set<string>): Set<string> {
	for (let cursor = 0; cursor < pending.length; cursor++) {
		for (const id of index.get(pending[cursor]!) ?? []) if (!seen.has(id)) {
			seen.add(id);
			pending.push(`mixer-node:${id}`);
		}
	}
	return seen;
}

/** Preserve enabled authored routes, including zero-level and all-silent channel maps. */
export function downstreamMixerNodes(graph: MixerGraphV21, tracks: ReadonlySet<string>, allowed?: ReadonlySet<string>): Set<string> {
	const next = new Map<string, string[]>();
	for (const edge of graph.edges) {
		if (!edge.enabled || edge.kind === 'sidechain' || edge.destination.kind !== 'mixer-node'
			|| (allowed && !allowed.has(edge.destination.id))) continue;
		if (edge.source.kind === 'track' || edge.source.kind === 'mixer-node') {
			append(next, `${edge.source.kind}:${edge.source.id}`, edge.destination.id);
		}
	}
	return visit(next, [...tracks].map(id => `track:${id}`), new Set());
}

export function mixerNodesReachingMain(graph: MixerGraphV21, allowed: ReadonlySet<string>): ReadonlySet<string> {
	const outputs = new Set(graph.outputs.filter(output => output.role === 'main').map(output => output.id));
	const previous = new Map<string, string[]>(), direct = new Set<string>();
	for (const edge of graph.edges) {
		if (!edge.enabled || edge.kind === 'sidechain' || edge.source.kind !== 'mixer-node'
			|| !allowed.has(edge.source.id)) continue;
		if (edge.destination.kind === 'master' || (edge.destination.kind === 'output' && outputs.has(edge.destination.id))) direct.add(edge.source.id);
		else if (edge.destination.kind === 'mixer-node') append(previous, `mixer-node:${edge.destination.id}`, edge.source.id);
	}
	return visit(previous, [...direct].map(id => `mixer-node:${id}`), direct);
}
