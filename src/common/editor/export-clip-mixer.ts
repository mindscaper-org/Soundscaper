/* SPDX-License-Identifier: AGPL-3.0-only */

import { mixerEndpointKeyV21, type MixerGraphV21 } from './mixer-graph-v21.ts';
import { createMixerRoutingClosureIndex } from './mixer-routing-closure.ts';
import type { StripRef } from './parameter-address.ts';

/** Retain programme routing and its detector feeds without admitting detector outputs. */
export function exportClipMixer(graph: MixerGraphV21, trackId: string): Readonly<{
	graph: MixerGraphV21;
	detectorStrips: ReadonlySet<string>;
	retainedEdges: ReadonlySet<string>;
}> {
	const routes = createMixerRoutingClosureIndex(graph);
	const closure = routes.programme([mixerEndpointKeyV21({ kind: 'track', id: trackId })]);
	const programme = closure.strips, retainedEdges = new Set(closure.edgeIds);
	const detectorSources: StripRef[] = [];
	for (const edge of graph.edges) {
		if (!edge.enabled || edge.destination.kind !== 'effect-sidechain'
			|| !programme.has(mixerEndpointKeyV21(edge.destination.strip))) continue;
		retainedEdges.add(edge.id);
		detectorSources.push(edge.source);
	}
	const incoming = routes.detector(detectorSources), detectorStrips = incoming.strips;
	for (const id of incoming.edgeIds) retainedEdges.add(id);
	// Admission requires an output path even for a detector-only strip. Its zero
	// output anchor retains that path; the caller retires its edge gain lane too.
	return { detectorStrips, retainedEdges, graph: { ...graph, edges: graph.edges.map(edge => retainedEdges.has(edge.id)
		? edge : { ...edge, level: 0 }) } };
}
