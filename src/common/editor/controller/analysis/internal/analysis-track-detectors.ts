/* SPDX-License-Identifier: AGPL-3.0-only */

import { mixerEndpointKeyV21, normalizeMixerGraphV21 } from '../../../mixer-graph-v21.ts';
import { createMixerRoutingClosureIndex } from '../../../mixer-routing-closure.ts';
import { hasProductionMixerProjectAuthority } from '../../../project-schema-version.ts';
import type { AnalysisRenderProject } from './analysis-renderer.ts';

/** Keep processed detector inputs alive, with no unrelated programme in the track curve. */
export function projectAnalysisTrackDetectors<Project extends AnalysisRenderProject>(project: Project, trackId: string): Project | null {
	if (!hasProductionMixerProjectAuthority(project)) return null;
	const graph = normalizeMixerGraphV21(project.mixer);
	if (!graph.edges.some(edge => edge.destination.kind === 'effect-sidechain')) return null;
	const index = createMixerRoutingClosureIndex(graph);
	const target = `track:${trackId}`;
	const programme = index.programme([target]);
	// Analysis omits the programme master rack. Its own detector inputs are
	// needed only if a different processed strip uses the master as a detector.
	const feeds = graph.edges.filter(edge => edge.enabled && edge.destination.kind === 'effect-sidechain'
		&& edge.destination.strip.kind !== 'master' && programme.strips.has(mixerEndpointKeyV21(edge.destination.strip)));
	const controls = index.detector(feeds.map(edge => edge.source));
	const masterControl = controls.strips.has('master');
	const retained = new Set([...programme.edgeIds, ...controls.edgeIds, ...feeds.map(edge => edge.id)]);
	const isControl = (key: string) => controls.strips.has(key) && !programme.strips.has(key);
	const strips = <Strip extends Readonly<{ id: string; mute: boolean; solo: boolean }>>(values: readonly Strip[]): Strip[] => values.map(strip => ({
		...strip, mute: isControl(`mixer-node:${strip.id}`) ? strip.mute : false, solo: false,
	}));
	return { ...project,
		tracks: project.tracks.map(track => track.type === 'audio' ? { ...track,
			mute: track.id === trackId ? false : controls.strips.has(`track:${track.id}`) ? Boolean(track.mute) : true,
			solo: false,
		} : track),
		master: masterControl ? project.master : { gain: 1, effects: [] },
		mixer: { ...graph, groups: strips(graph.groups), sends: strips(graph.sends), cues: strips(graph.cues),
			// Keep the structural routes and channel maps. Removing their level
			// automation makes a zero output anchor stable throughout the render.
			edges: graph.edges.filter(edge => masterControl || edge.destination.kind !== 'effect-sidechain' || edge.destination.strip.kind !== 'master')
				.map(edge => retained.has(edge.id) ? edge : { ...edge, level: 0 }),
		},
		...(project.automationLanes ? { automationLanes: project.automationLanes.filter(({ address }) => {
			if (address.kind === 'edge') return retained.has(address.edgeId);
			if (address.strip.kind === 'master') return masterControl;
			return address.kind !== 'strip' || address.parameterId !== 'mute' || isControl(mixerEndpointKeyV21(address.strip));
		}) } : {}),
	};
}
