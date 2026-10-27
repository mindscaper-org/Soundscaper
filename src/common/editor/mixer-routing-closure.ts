/* SPDX-License-Identifier: AGPL-3.0-only */

import { mixerEndpointKeyV21, type MixerGraphV21 } from './mixer-graph-v21.ts';
import type { StripRef } from './parameter-address.ts';

interface Link { readonly edgeId: string; readonly strip: string | null }
export interface MixerRoutingClosure {
	readonly strips: ReadonlySet<string>;
	readonly edgeIds: ReadonlySet<string>;
}

/** One invocation owns adjacency for programme routes and incoming detector feeds. */
export function createMixerRoutingClosureIndex(
	graph: Pick<MixerGraphV21, 'edges'>,
	options: Readonly<{ includeDisabled?: boolean }> = {},
): Readonly<{
	programme(seeds: Iterable<string>): MixerRoutingClosure;
	detector(seeds: Iterable<StripRef>): MixerRoutingClosure;
}> {
	const outgoing = new Map<string, Link[]>(), incoming = new Map<string, Link[]>();
	const add = (index: Map<string, Link[]>, key: string, link: Link): void => {
		const links = index.get(key);
		if (links) links.push(link); else index.set(key, [link]);
	};
	for (const edge of graph.edges) {
		if (!edge.enabled && !options.includeDisabled) continue;
		const source = mixerEndpointKeyV21(edge.source), destination = edge.destination;
		const target = destination.kind === 'output' ? null : mixerEndpointKeyV21(
			destination.kind === 'effect-sidechain' ? destination.strip : destination,
		);
		if (destination.kind !== 'effect-sidechain') add(outgoing, source, { edgeId: edge.id, strip: target });
		if (target !== null) add(incoming, target, { edgeId: edge.id, strip: source });
	}
	return {
		programme: seeds => traverse(outgoing, seeds),
		detector: seeds => traverse(incoming, [...seeds].map(mixerEndpointKeyV21)),
	};
}

function traverse(index: ReadonlyMap<string, readonly Link[]>, seeds: Iterable<string>): MixerRoutingClosure {
	const strips = new Set(seeds), pending = [...strips], edgeIds = new Set<string>();
	for (let cursor = 0; cursor < pending.length; cursor++) {
		for (const link of index.get(pending[cursor]!) ?? []) {
			edgeIds.add(link.edgeId);
			if (link.strip !== null && !strips.has(link.strip)) {
				strips.add(link.strip);
				pending.push(link.strip);
			}
		}
	}
	return { strips, edgeIds };
}
