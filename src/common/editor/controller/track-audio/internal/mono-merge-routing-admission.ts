/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from '../../../automation-lane-v21.ts';
import { defaultMixerChannelMapV21, normalizeMixerGraphV21, type MixerEdgeV21 } from '../../../mixer-graph-v21.ts';
import { isSoundscaperProductionProject } from '../../../project-schema-version.ts';

/** A merged stereo strip can retain only one shared outgoing graph. */
export function monoMergeRoutingCompatible(
	project: Readonly<Record<string, unknown>>, leftTrackId: string, rightTrackId: string, bakeTrackEffects = false,
): boolean {
	if (!isSoundscaperProductionProject(project)) return true;
	const graph = normalizeMixerGraphV21(project.mixer);
	const lanes = new Map<string, string[]>();
	for (const value of Array.isArray(project.automationLanes) ? project.automationLanes as readonly unknown[] : []) {
		const address = value && typeof value === 'object' ? (value as { address?: { kind?: unknown } }).address : null;
		if (address?.kind !== 'edge') continue;
		const lane = normalizeAutomationLaneV21(value);
		if (lane.address.kind !== 'edge') continue;
		const { id: _id, address: _address, points, ...settings } = lane;
		const { edgeId: _edgeId, ...parameter } = lane.address;
		const signature = JSON.stringify({ ...settings, parameter, points: points.map(({ id: _pointId, ...point }) => point) });
		const values = lanes.get(lane.address.edgeId) ?? [];
		values.push(signature); lanes.set(lane.address.edgeId, values);
	}
	const route = (edge: MixerEdgeV21): string | null => {
		const normal = edge.channelMap.length ? defaultMixerChannelMapV21(1, edge.channelMap.length) : [];
		if (!edge.channelMap.every((channel, index) => channel === normal[index])
			&& !edge.channelMap.every(channel => channel === -1)) return null;
		return JSON.stringify({ kind: edge.kind, destination: edge.destination, position: edge.position,
			level: edge.level, enabled: edge.enabled, channelMap: edge.channelMap,
			automation: [...(lanes.get(edge.id) ?? [])].sort() });
	};
	const removedDetector = (edge: MixerEdgeV21): boolean => bakeTrackEffects && edge.destination.kind === 'effect-sidechain'
		&& edge.destination.strip.kind === 'track' && [leftTrackId, rightTrackId].includes(edge.destination.strip.id);
	const routes = (trackId: string) => graph.edges.filter(edge => edge.source.kind === 'track' && edge.source.id === trackId && !removedDetector(edge))
		.map(route).sort();
	const left = routes(leftTrackId), right = routes(rightTrackId);
	if (left.includes(null) || right.includes(null) || JSON.stringify(left) !== JSON.stringify(right)) return false;
	return graph.vcas.every(vca => vca.members.some(member => member.kind === 'track' && member.id === leftTrackId)
		=== vca.members.some(member => member.kind === 'track' && member.id === rightTrackId));
}
