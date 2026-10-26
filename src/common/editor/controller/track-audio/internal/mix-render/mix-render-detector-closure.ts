/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMixerRoutingClosureIndex } from '../../../../mixer-routing-closure.ts';
import type { StripRef } from '../../../../parameter-address.ts';
import { mixerEndpointKeyV21, type MixerGraphV21 } from '../../../../mixer-graph-v21.ts';
import type { ControllerTrack } from '../../track-domain-types.ts';

export interface MixRenderDetectorClosure {
	readonly controlTrackIds: ReadonlySet<string>;
	readonly nodeIds: ReadonlySet<string>;
	readonly edgeIds: ReadonlySet<string>;
}

/** Preserve the authored input graph of every active external detector. */
export function mixRenderDetectorClosure(
	graph: MixerGraphV21, tracks: readonly ControllerTrack[],
	programmeTrackIds: ReadonlySet<string>, programmeNodeIds: ReadonlySet<string>,
): MixRenderDetectorClosure {
	return prepareMixRenderDetectorClosure(graph, tracks)(programmeTrackIds, programmeNodeIds);
}

export function prepareMixRenderDetectorClosure(graph: MixerGraphV21, tracks: readonly ControllerTrack[]): (
	programmeTrackIds: ReadonlySet<string>, programmeNodeIds: ReadonlySet<string>,
) => MixRenderDetectorClosure {
	const activeEffects = new Map<string, ReadonlySet<string>>();

	for (const track of tracks) activeEffects.set(`track:${track.id}`, enabledEffects(track));
	for (const node of [...graph.groups, ...graph.sends, ...graph.cues]) activeEffects.set(`mixer-node:${node.id}`, enabledEffects(node));
	const active = { ...graph, edges: graph.edges.filter(edge => edge.enabled && (edge.destination.kind !== 'effect-sidechain'
		|| activeEffects.get(mixerEndpointKeyV21(edge.destination.strip))?.has(edge.destination.effectId))) };
	const routes = createMixerRoutingClosureIndex(active);
	return (programmeTrackIds, programmeNodeIds): MixRenderDetectorClosure => {
		const programme = new Set([...programmeTrackIds].map(id => `track:${id}`)
			.concat([...programmeNodeIds].map(id => `mixer-node:${id}`)));
		const detectorSources: StripRef[] = [], edgeIds = new Set<string>();
		for (const edge of active.edges) {
			if (edge.destination.kind !== 'effect-sidechain' || !programme.has(mixerEndpointKeyV21(edge.destination.strip))) continue;
			edgeIds.add(edge.id);
			detectorSources.push(edge.source);
		}
		const closure = routes.detector(detectorSources), strips = closure.strips;
		for (const id of closure.edgeIds) edgeIds.add(id);
		return { controlTrackIds: new Set(tracks.filter(track => strips.has(`track:${track.id}`)).map(track => track.id)),
			nodeIds: new Set([...graph.groups, ...graph.sends, ...graph.cues].filter(node => strips.has(`mixer-node:${node.id}`)).map(node => node.id)), edgeIds };
	};
}

function enabledEffects(strip: Readonly<{ effectsActive?: unknown; effects?: readonly Readonly<Record<string, unknown>>[] }>): ReadonlySet<string> {
	return new Set(strip.effectsActive === false ? [] : (strip.effects ?? []).filter(effect => effect.enabled !== false && effect.bypassed !== true).map(effect => String(effect.id)));
}
