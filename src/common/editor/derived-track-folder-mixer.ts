/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeAutomationLaneV21 } from './automation-lane-v21.ts';
import type { AudioEditorCommand } from './commands/protocol.ts';
import { normalizeMixerGraphV21, type MixerEdgeV21, type MixerGraphV21 } from './mixer-graph-v21.ts';

type Project = Readonly<Record<string, unknown>>;

/** Replacing the final audio track must not reset its surviving folder's mixer. */
export function preserveDerivedFolderMixer(
	original: Project, staged: Project, originalGraph: MixerGraphV21, stagedGraph: MixerGraphV21,
): Readonly<{ graph: MixerGraphV21; folderIds: ReadonlySet<string> }> {
	const folderIds = new Set(folderRecords(original).map(folder => String(folder.id)));
	const surviving = new Set(folderRecords(staged).map(folder => String(folder.id)));
	const originalById = new Map(originalGraph.groups.map(group => [group.id, group]));
	const retained = new Set(stagedGraph.groups.flatMap(group => folderIds.has(group.id) && surviving.has(group.id)
		&& originalById.has(group.id) ? [group.id] : []));
	if (!retained.size) return { graph: stagedGraph, folderIds: retained };
	const groups = stagedGraph.groups.map(group => retained.has(group.id) ? { ...originalById.get(group.id)!, name: group.name } : group);
	const tracks = new Map(records(staged.tracks).map(track => [String(track.id), track]));
	const nodes = new Map([...groups, ...stagedGraph.sends, ...stagedGraph.cues].map(node => [node.id, node]));
	const effectExists = (edge: MixerEdgeV21): boolean => {
		if (edge.destination.kind !== 'effect-sidechain') return true;
		const { strip: host, effectId } = edge.destination;
		const strip = host.kind === 'master' ? staged.master : host.kind === 'track' ? tracks.get(host.id) : nodes.get(host.id);
		return records(record(strip).effects).some(effect => effect.id === effectId);
	};
	const outputs = new Set(stagedGraph.outputs.map(output => output.id));
	const sourceExists = (edge: MixerEdgeV21) => edge.source.kind === 'track' ? tracks.has(edge.source.id)
		: edge.source.kind === 'mixer-node' ? nodes.has(edge.source.id) : true;
	const destinationExists = (edge: MixerEdgeV21) => edge.destination.kind === 'mixer-node' ? nodes.has(edge.destination.id)
		: edge.destination.kind === 'output' ? outputs.has(edge.destination.id) : effectExists(edge);
	const edges = stagedGraph.edges.filter(edge => !touchesFolder(edge, retained));
	for (const edge of originalGraph.edges) {
		if (touchesFolder(edge, retained) && sourceExists(edge) && destinationExists(edge)) edges.push(edge);
	}
	const originalVcas = new Map<string, MixerGraphV21['vcas'][number]>();
	for (const vca of originalGraph.vcas) if (!originalVcas.has(vca.id)) originalVcas.set(vca.id, vca);
	const vcas = stagedGraph.vcas.map(vca => {
		const members = [...vca.members];
		const owned = new Set(members.flatMap(member => member.kind === 'mixer-node' ? [member.id] : []));
		for (const member of originalVcas.get(vca.id)?.members ?? []) {
			if (member.kind === 'mixer-node' && retained.has(member.id)
				&& !owned.has(member.id)) {
				members.push(member);
				owned.add(member.id);
			}
		}
		return { ...vca, members };
	});
	return { graph: normalizeMixerGraphV21({ ...stagedGraph, groups, edges, vcas }), folderIds: retained };
}

/** Restore only missing lanes whose surviving bus/edge has been restored above. */
export function preservedDerivedFolderAutomation(
	original: Project, staged: Project, graph: MixerGraphV21, folders: ReadonlySet<string>,
	planned: readonly AudioEditorCommand[],
): readonly AudioEditorCommand[] {
	const occupied = new Set(records(staged.automationLanes).map(lane => String(lane.id)));
	for (const command of planned) if (command.type === 'automation-lane/set') occupied.add(command.laneId);
	const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
	return records(original.automationLanes).flatMap(value => {
		const lane = normalizeAutomationLaneV21(value);
		if (occupied.has(lane.id)) return [];
		const address = lane.address;
		const retained = address.kind === 'edge'
			? edges.has(address.edgeId) && touchesFolder(edges.get(address.edgeId)!, folders)
			: address.strip.kind === 'mixer-node' && folders.has(address.strip.id);
		return retained ? [{ type: 'automation-lane/set' as const, laneId: lane.id, expected: null, lane: { ...lane } }] : [];
	});
}

function touchesFolder(edge: MixerEdgeV21, folders: ReadonlySet<string>): boolean {
	if (edge.source.kind === 'mixer-node' && folders.has(edge.source.id)) return true;
	if (edge.destination.kind === 'mixer-node') return folders.has(edge.destination.id);
	return edge.destination.kind === 'effect-sidechain' && edge.destination.strip.kind === 'mixer-node'
		&& folders.has(edge.destination.strip.id);
}
function record(value: unknown): Project { return value && typeof value === 'object' ? value as Project : {}; }
function records(value: unknown): readonly Project[] { return Array.isArray(value) ? value.map(record) : []; }
function folderRecords(project: Project): readonly Project[] { return records(project.trackFolders); }
