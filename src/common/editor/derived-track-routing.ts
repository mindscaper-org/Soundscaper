/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from './commands/protocol.ts';
import { preserveDerivedFolderMixer, preservedDerivedFolderAutomation } from './derived-track-folder-mixer.ts';
import { derivedTrackSidechainRoutes } from './derived-track-sidechains.ts';
import { copyDerivedTrackRouteAutomation, type DerivedTrackRouteCopy } from './derived-track-route-automation.ts';
import {
	defaultMixerChannelMapV21,
	normalizeMixerGraphV21,
	mixerEndpointKeyV21,
	type MixerEdgeV21,
	type MixerGraphV21,
} from './mixer-graph-v21.ts';
import { isSoundscaperProductionProject } from './project-schema-version.ts';
import { resolveTerminalChannelWidths } from './terminal-channel-widths.ts';

type RoutingProject = Readonly<Record<string, unknown>>;

/** Preserve an authored track's outgoing topology when deriving replacement tracks. */
export function preserveProductionTrackRouting<Project extends RoutingProject>(
	project: Project,
	command: Extract<AudioEditorCommand, { readonly type: 'batch' }>,
	routingCopies: readonly Readonly<{ readonly sourceTrackId: string; readonly targetTrackId: string }>[],
	previewCommand: ((project: Project, command: AudioEditorCommand) => RoutingProject) | undefined,
	createId: (prefix: string) => string,
	directRoutingTrackIds: readonly string[] = [],
): Extract<AudioEditorCommand, { readonly type: 'batch' }> {
	if ((!routingCopies.length && !directRoutingTrackIds.length)
		|| !isSoundscaperProductionProject(project) || !previewCommand) return command;
	const staged = previewCommand(project, command);
	const originalGraph = normalizeMixerGraphV21(project.mixer as never);
	const stagedGraph = normalizeMixerGraphV21(staged.mixer as never);
	const folders = preserveDerivedFolderMixer(project, staged, originalGraph, stagedGraph);
	const { graph: desired, edgeCopies } = restateRoutes(
		project,
		staged,
		folders.graph,
		originalGraph,
		routingCopies,
		directRoutingTrackIds,
		createId,
	);
	const graphCommand: AudioEditorCommand = {
		type: 'mixer-graph/set',
		expected: stagedGraph as unknown as Readonly<Record<string, unknown>>,
		mixer: desired as unknown as Readonly<Record<string, unknown>>,
	};
	const automation = copyDerivedTrackRouteAutomation(project, staged, edgeCopies, createId);
	const folderAutomation = preservedDerivedFolderAutomation(project, staged, desired, folders.folderIds, automation);
	return Object.freeze({ type: 'batch', commands: Object.freeze([...command.commands, graphCommand, ...automation, ...folderAutomation]) });
}

function restateRoutes(
	originalProject: RoutingProject,
	project: RoutingProject,
	staged: MixerGraphV21,
	original: MixerGraphV21,
	copies: readonly Readonly<{ readonly sourceTrackId: string; readonly targetTrackId: string }>[],
	directTrackIds: readonly string[],
	createId: (prefix: string) => string,
): Readonly<{ graph: MixerGraphV21; edgeCopies: readonly DerivedTrackRouteCopy[] }> {
	const edgeCopies: DerivedTrackRouteCopy[] = [];
	const targetIds = new Set([
		...copies.map(({ targetTrackId }) => targetTrackId),
		...directTrackIds,
	]);
	const widths = resolveTerminalChannelWidths(project as never, Number(project.masterChannels));
	const originalWidths = resolveTerminalChannelWidths(
		originalProject as never,
		Number(originalProject.masterChannels),
	);
	const destinationWidth = edgeDestinationWidthReader(staged, widths.tracks);
	const originalDestination = edgeDestinationWidthReader(original, originalWidths.tracks);
	const outgoing = new Map<string, MixerEdgeV21[]>();
	for (const route of original.edges) {
		if (route.source.kind !== 'track' || route.destination.kind === 'effect-sidechain') continue;
		const routes = outgoing.get(route.source.id);
		if (routes) routes.push(route);
		else outgoing.set(route.source.id, [route]);
	}
	const edges = staged.edges.filter((edge) => !(
		edge.source.kind === 'track' && targetIds.has(edge.source.id)
	));
	const occupiedIds = new Set(edges.map(({ id }) => id));
	for (const copy of copies) {
		for (const route of outgoing.get(copy.sourceTrackId) ?? []) {
			const sourceWidth = widths.tracks.get(copy.targetTrackId) ?? Number(project.masterChannels);
			const originalSourceWidth = originalWidths.tracks.get(copy.sourceTrackId)
				?? Number(originalProject.masterChannels);
			const targetWidth = destinationWidth(route);
			const originalDestinationWidth = originalDestination(route);
			const remainsValid = route.channelMap.length === targetWidth
				&& route.channelMap.every((channel) => channel === -1
					|| (channel >= 0 && channel < sourceWidth));
			const wasDefault = sameChannelMap(
				route.channelMap,
				defaultMixerChannelMapV21(originalSourceWidth, originalDestinationWidth),
			);
			const channelMap = remainsValid && !wasDefault
				? route.channelMap
				: defaultMixerChannelMapV21(sourceWidth, targetWidth);
			let id = copy.sourceTrackId === copy.targetTrackId ? route.id
				: copiedRouteId(route, copy.sourceTrackId, copy.targetTrackId) ?? createId('mix-route');
			while (occupiedIds.has(id)) id = createId('mix-route');
			occupiedIds.add(id);
			edgeCopies.push({ sourceEdgeId: route.id, targetEdgeId: id });
			edges.push({
				...structuredClone(route), id,
				source: { kind: 'track', id: copy.targetTrackId },
				channelMap,
			});
		}
	}
	const sidechainTerminals = new Set<string>();
	for (const edge of edges) {
		const key = edge.kind === 'sidechain' ? sidechainKey(edge) : null;
		if (key !== null) sidechainTerminals.add(key);
	}
	for (const { original: route, route: copied } of derivedTrackSidechainRoutes(originalProject, project, original.edges, copies)) {
		const terminals = sidechainKey(copied)!;
		if (sidechainTerminals.has(terminals)) continue;
		const sourceWidth = copied.source.kind === 'track'
			? widths.tracks.get(copied.source.id) ?? Number(project.masterChannels)
			: destinationWidth({ ...copied, destination: copied.source });
		const targetWidth = destinationWidth(copied);
		const originalSourceWidth = route.source.kind === 'track'
			? originalWidths.tracks.get(route.source.id) ?? Number(originalProject.masterChannels)
			: originalDestination({ ...route, destination: route.source });
		const wasDefault = sameChannelMap(route.channelMap, defaultMixerChannelMapV21(
			originalSourceWidth, originalDestination(route),
		));
		const remainsValid = route.channelMap.length === targetWidth
			&& route.channelMap.every(channel => channel === -1 || (channel >= 0 && channel < sourceWidth));
		let id = sameSidechainTerminals(route, copied) && !occupiedIds.has(route.id)
			? route.id : createId('mix-route');
		while (occupiedIds.has(id)) id = createId('mix-route');
		occupiedIds.add(id);
		edgeCopies.push({ sourceEdgeId: route.id, targetEdgeId: id });
		edges.push({ ...structuredClone(copied), id, channelMap: remainsValid && !wasDefault
			? route.channelMap : defaultMixerChannelMapV21(sourceWidth, targetWidth) });
		if (copied.kind === 'sidechain') sidechainTerminals.add(terminals);
	}
	for (const trackId of directTrackIds) {
		const sourceWidth = widths.tracks.get(trackId) ?? Number(project.masterChannels);
		const destinationWidth = Number(project.masterChannels);
		let id = `assignment:track:${trackId}:master`;
		while (occupiedIds.has(id)) id = createId('mix-route');
		occupiedIds.add(id);
		edges.push({
			id,
			kind: 'assignment',
			source: { kind: 'track', id: trackId },
			destination: { kind: 'master' },
			position: 'post-fader', level: 1, enabled: true,
			channelMap: defaultMixerChannelMapV21(sourceWidth, destinationWidth),
		});
	}
	// Combined audio already includes these tracks' VCA controls. A retained
	// identity must leave those memberships before its printed source plays.
	const bakedTrackIds = new Set(directTrackIds);
	const originalVcas = new Map<string, MixerGraphV21['vcas'][number]>();
	for (const vca of original.vcas) if (!originalVcas.has(vca.id)) originalVcas.set(vca.id, vca);
	const vcas = staged.vcas.map(vca => {
		const members = vca.members.filter(member => member.kind !== 'track' || !bakedTrackIds.has(member.id));
		const sourceMembers = new Set((originalVcas.get(vca.id)?.members ?? []).flatMap(member => member.kind === 'track' ? [member.id] : []));
		const targetMembers = new Set(members.flatMap(member => member.kind === 'track' ? [member.id] : []));
		for (const copy of copies) {
			if (sourceMembers.has(copy.sourceTrackId) && !targetMembers.has(copy.targetTrackId)) {
				members.push({ kind: 'track', id: copy.targetTrackId });
				targetMembers.add(copy.targetTrackId);
			}
		}
		return { ...vca, members };
	});
	return { graph: normalizeMixerGraphV21({ ...staged, edges, vcas }), edgeCopies };
}

function sameChannelMap(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((channel, index) => channel === right[index]);
}

function copiedRouteId(
	edge: MixerEdgeV21,
	sourceTrackId: string,
	targetTrackId: string,
): string | null {
	if (edge.destination.kind === 'effect-sidechain') return null;
	const destination = edge.destination.kind === 'master'
		? 'master' : `${edge.destination.kind}:${edge.destination.id}`;
	return edge.id === `${edge.kind}:track:${sourceTrackId}:${destination}`
		? `${edge.kind}:track:${targetTrackId}:${destination}` : null;
}

function edgeDestinationWidthReader(
	graph: MixerGraphV21,
	trackWidths: ReadonlyMap<string, number>,
): (edge: MixerEdgeV21) => number {
	const nodes = new Map<string, number>(), outputs = new Map<string, number>();
	for (const node of [...graph.groups, ...graph.sends, ...graph.cues]) if (!nodes.has(node.id)) nodes.set(node.id, node.channelCount);
	let mainWidth = 2, mainFound = false;
	for (const output of graph.outputs) {
		if (!outputs.has(output.id)) outputs.set(output.id, output.channelCount);
		if (!mainFound && output.role === 'main') { mainFound = true; mainWidth = output.channelCount; }
	}
	return (edge) => {
		const destination = edge.destination;
		if (destination.kind === 'effect-sidechain') {
			const strip = destination.strip;
			if (strip.kind === 'master') {
				return mainWidth;
			}
			if (strip.kind === 'track') return trackWidths.get(strip.id) ?? 2;
			return nodes.get(strip.id) ?? 2;
		}
		if (destination.kind === 'master') {
			return mainWidth;
		}
		if (destination.kind === 'output') {
			return outputs.get(destination.id) ?? 2;
		}
		if (destination.kind === 'mixer-node') {
			return nodes.get(destination.id) ?? 2;
		}
		return 2;
	};
}

function sidechainKey(edge: MixerEdgeV21): string | null {
	if (edge.destination.kind !== 'effect-sidechain') return null;
	const destination = edge.destination;
	return JSON.stringify([mixerEndpointKeyV21(edge.source), destination.effectId,
		destination.strip.kind, destination.strip.kind === 'master' ? null : destination.strip.id]);
}

function sameSidechainTerminals(left: MixerEdgeV21, right: MixerEdgeV21): boolean {
	return left.destination.kind === 'effect-sidechain' && right.destination.kind === 'effect-sidechain'
		&& mixerEndpointKeyV21(left.source) === mixerEndpointKeyV21(right.source)
		&& left.destination.effectId === right.destination.effectId
		&& left.destination.strip.kind === right.destination.strip.kind
		&& (left.destination.strip.kind === 'master' || (right.destination.strip.kind !== 'master'
			&& left.destination.strip.id === right.destination.strip.id));
}
