/* SPDX-License-Identifier: AGPL-3.0-only */

import { mixRenderDetectorClosure, type MixRenderDetectorClosure } from './mix-render-detector-closure.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import {
	createDefaultMixerGraphV21,
	defaultMixerChannelMapV21,
	normalizeMixerGraphV21,
	type MixerGraphV21,
} from '../../../../mixer-graph-v21.ts';
import type { ProjectFeatureRequirementsManifest } from '../../../../project-feature-requirements.ts';
import { resolveTerminalChannelWidths } from '../../../../terminal-channel-widths.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../../../../track-folder-media-runtime.ts';
import { projectTransientRenderFeatures } from '../../../shared/transient-render-feature-projection.ts';
import {
	type ControllerProject,
	type ControllerTrack,
	type MutableControllerProject,
} from '../../track-domain-types.ts';

interface SnapshotOptions {
	readonly mixDown?: boolean;
	readonly renderEffects?: boolean;
}

interface MutableMixRenderProjectV21 extends MutableControllerProject {
	featureRequirements: ProjectFeatureRequirementsManifest;
	mixer: MutableControllerProject['mixer'] & MixerGraphV21;
	automationLanes: unknown[];
	masterChannels: number;
}

export function createMixRenderSnapshotV21(
	authored: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	options: Readonly<SnapshotOptions>,
): MutableControllerProject {
	const project = projectTrackFolderMediaStateV12(authored);
	const snapshot = inheritTrackFolderMediaStateProjectionV12(
		project,
		cloneProject(project),
	) as MutableMixRenderProjectV21;
	const targetIds = new Set(targetTracks.map(({ id }) => id));
	const includeDownstream = options.mixDown ?? targetTracks.length > 1;
	const renderEffects = options.renderEffects ?? true;
	const graph = normalizeMixerGraphV21(snapshot.mixer);
	const nodeIds = includeDownstream ? reachableMixerNodeIds(graph, targetIds) : new Set<string>();
	const detectors = renderEffects
		? mixRenderDetectorClosure(graph, snapshot.tracks, targetIds, nodeIds)
		: { controlTrackIds: new Set<string>(), nodeIds: new Set<string>(), edgeIds: new Set<string>() };
	const retainedNodeIds = new Set([...nodeIds, ...detectors.nodeIds]);
	const unselectedControlTrackIds = new Set([...detectors.controlTrackIds]
		.filter((trackId) => !targetIds.has(trackId)));
	const renderTrackIds = new Set([...targetIds, ...unselectedControlTrackIds]);
	narrowMedia(snapshot, targetIds, renderTrackIds, renderEffects);
	if (!includeDownstream) {
		snapshot.metadata = { ...dataRecord(snapshot.metadata, 'individual mix metadata'), adm: null };
		isolateIndividualGraph(snapshot, graph, targetTracks, detectors, renderEffects);
		return reconcileMixRenderRequirementsV21(snapshot);
	}
	const edges = graph.edges.filter((edge) => edgeSurvivesCombined(
		edge, renderTrackIds, targetIds, retainedNodeIds, nodeIds, detectors.edgeIds, renderEffects,
	)).concat(silentControlAssignments(snapshot, unselectedControlTrackIds));
	const edgeIds = new Set(edges.map(({ id }) => id));
	snapshot.mixer = normalizeMixerGraphV21({
		...graph,
		groups: graph.groups.filter(({ id }) => retainedNodeIds.has(id))
			.map((strip) => renderEffects ? strip : { ...strip, effects: [] }),
		sends: graph.sends.filter(({ id }) => retainedNodeIds.has(id))
			.map((strip) => renderEffects ? strip : { ...strip, effects: [] }),
		cues: graph.cues.filter(({ id }) => retainedNodeIds.has(id)),
		vcas: graph.vcas.map((vca) => ({
			...vca,
			members: vca.members.filter((member) => {
				if (member.kind === 'master') return false;
				return member.kind === 'track'
					? renderTrackIds.has(member.id) : retainedNodeIds.has(member.id);
			}),
		})).filter(({ members }) => members.length),
		edges,
	}) as MutableMixRenderProjectV21['mixer'];
	snapshot.automationLanes = snapshot.automationLanes.filter((lane) => (
		laneSurvivesMixSnapshot(lane, renderTrackIds, retainedNodeIds, edgeIds)
		&& (renderEffects || !laneTargetsEffect(lane))
	));
	return reconcileMixRenderRequirementsV21(snapshot);
}

export function v21TrackAutomationRemovalCommands(
	project: ControllerProject,
	trackId: string,
): AudioEditorCommand[] {
	const lanes = (project as unknown as Readonly<Record<string, unknown>>).automationLanes;
	if (!Array.isArray(lanes)) throw new TypeError('A V21 mix render requires automationLanes.');
	return lanes.flatMap((lane): AudioEditorCommand[] => {
		if (!laneTargetsTrack(lane, trackId)) return [];
		const record = dataRecord(lane, 'automation lane');
		return [{
			type: 'automation-lane/set', laneId: String(record.id), expected: record, lane: null,
		}];
	});
}

function narrowMedia(
	snapshot: MutableMixRenderProjectV21,
	targetIds: ReadonlySet<string>,
	renderTrackIds: ReadonlySet<string>,
	renderEffects: boolean,
): void {
	snapshot.tracks = snapshot.tracks
		.filter((track) => track.type === 'audio' && renderTrackIds.has(track.id))
		.map((track) => {
			const result = (targetIds.has(track.id)
				? { ...track, mute: false, solo: false, ...(renderEffects ? {} : { effects: [] }) }
				: { ...track, mute: false, solo: false }
			) as Record<string, unknown>;
			delete result.envelope;
			return result as unknown as ControllerTrack;
		});
	const clipIds = new Set(snapshot.tracks.flatMap((track) => (track.clipIds ?? [])));
	snapshot.clips = snapshot.clips.filter((clip) => clipIds.has(clip.id));
	const sourceIds = new Set(snapshot.clips.map((clip) => clip.sourceId));
	snapshot.sources = snapshot.sources.filter((source) => sourceIds.has(source.id));
	if (!Array.isArray(snapshot.trackFolders) || !snapshot.trackFolders.length) {
		if (!Array.isArray(snapshot.sequences)) throw new TypeError('A V21 mix render requires sequences.');
		snapshot.sequences = snapshot.sequences.map((value) => {
			const sequence = dataRecord(value, 'mix render sequence');
			const trackIds = Array.isArray(sequence.trackIds) ? sequence.trackIds : [];
			const trackNodes = Array.isArray(sequence.trackNodes) ? sequence.trackNodes : [];
			return {
				...sequence,
				trackIds: trackIds.filter((id) => renderTrackIds.has(String(id))),
				trackNodes: trackNodes.filter((value) => {
					const node = dataRecord(value, 'mix render track node');
					return node.kind !== 'track' || renderTrackIds.has(String(node.id));
				}),
			};
		});
	}
	snapshot.selection = {
		...snapshot.selection,
		startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], frequencyRange: null,
	};
}

function isolateIndividualGraph(
	snapshot: MutableMixRenderProjectV21,
	authoredGraph: MixerGraphV21,
	targetTracks: readonly ControllerTrack[],
	detectors: MixRenderDetectorClosure,
	renderEffects: boolean,
): void {
	const widths = resolveTerminalChannelWidths(snapshot as never, snapshot.masterChannels).tracks;
	const direct = createDefaultMixerGraphV21(snapshot.tracks.map((track) => ({
		id: track.id,
		channelCount: widths.get(track.id) ?? snapshot.masterChannels,
	})), snapshot.masterChannels);
	const targetIds = new Set(targetTracks.map(({ id }) => id));
	const occupiedIds = new Set(authoredGraph.edges.map(edge => edge.id));
	const targetAssignments = direct.edges.map((edge) => edge.source.kind === 'track'
		&& !targetIds.has(edge.source.id) && detectors.controlTrackIds.has(edge.source.id)
		? { ...edge, id: controlAssignmentId(edge.source.id, occupiedIds), level: 0 } : edge);
	const sidechains = renderEffects
		? authoredGraph.edges.filter(({ id }) => detectors.edgeIds.has(id))
		: [];
	snapshot.mixer = normalizeMixerGraphV21({
		...direct,
		groups: authoredGraph.groups.filter(node => detectors.nodeIds.has(node.id)),
		sends: authoredGraph.sends.filter(node => detectors.nodeIds.has(node.id)),
		cues: authoredGraph.cues.filter(node => detectors.nodeIds.has(node.id)),
		vcas: authoredGraph.vcas.map(vca => ({ ...vca, members: vca.members.filter(member => member.kind === 'track'
			? detectors.controlTrackIds.has(member.id) && !targetIds.has(member.id)
			: member.kind === 'mixer-node' && detectors.nodeIds.has(member.id)) })).filter(vca => vca.members.length),
		edges: [...targetAssignments, ...sidechains],
	}) as MutableMixRenderProjectV21['mixer'];
	const edgeIds = new Set(snapshot.mixer.edges.map(({ id }) => id));
	const renderTrackIds = new Set(snapshot.tracks.map(({ id }) => id));
	snapshot.automationLanes = snapshot.automationLanes.filter((lane) => (
		laneSurvivesMixSnapshot(lane, renderTrackIds, detectors.nodeIds, edgeIds)
		&& (renderEffects || !laneTargetsEffect(lane))
	));
}

function silentControlAssignments(
	project: MutableMixRenderProjectV21,
	controlTrackIds: ReadonlySet<string>,
): MixerGraphV21['edges'][number][] {
	const widths = resolveTerminalChannelWidths(project as never, project.masterChannels).tracks;
	const occupiedIds = new Set(project.mixer.edges.map(edge => edge.id));
	return [...controlTrackIds].map((trackId) => ({
		id: controlAssignmentId(trackId, occupiedIds),
		kind: 'assignment',
		source: { kind: 'track', id: trackId },
		destination: { kind: 'master' },
		position: 'post-fader',
		level: 0,
		enabled: true,
		channelMap: defaultMixerChannelMapV21(
			widths.get(trackId) ?? project.masterChannels,
			project.masterChannels,
		),
	}));
}

function controlAssignmentId(trackId: string, occupied: Set<string>): string {
	let id = `mix-render-control:${trackId}`;
	while (occupied.has(id)) id += ':';
	occupied.add(id); return id;
}

function reachableMixerNodeIds(
	graph: MixerGraphV21,
	targetTrackIds: ReadonlySet<string>,
): Set<string> {
	const busIds = new Set([...graph.groups, ...graph.sends].map(({ id }) => id));
	const forward = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of graph.edges) {
			if (!edge.enabled || edge.kind === 'sidechain' || edge.destination.kind !== 'mixer-node'
				|| !busIds.has(edge.destination.id)) continue;
			const sourceIsReachable = edge.source.kind === 'track'
				? targetTrackIds.has(edge.source.id)
				: edge.source.kind === 'mixer-node' && forward.has(edge.source.id);
			if (sourceIsReachable && !forward.has(edge.destination.id)) {
				forward.add(edge.destination.id);
				changed = true;
			}
		}
	}
	const mainOutputIds = new Set(graph.outputs.filter(({ role }) => role === 'main').map(({ id }) => id));
	const reachesMain = new Set<string>();
	changed = true;
	while (changed) {
		changed = false;
		for (const edge of graph.edges) {
			if (!edge.enabled || edge.kind === 'sidechain' || edge.source.kind !== 'mixer-node'
				|| !busIds.has(edge.source.id)) continue;
			const destinationReachesMain = edge.destination.kind === 'master'
				|| (edge.destination.kind === 'output' && mainOutputIds.has(edge.destination.id))
				|| (edge.destination.kind === 'mixer-node' && reachesMain.has(edge.destination.id));
			if (destinationReachesMain && !reachesMain.has(edge.source.id)) {
				reachesMain.add(edge.source.id);
				changed = true;
			}
		}
	}
	return new Set([...forward].filter((id) => reachesMain.has(id)));
}

function edgeSurvivesCombined(
	edge: MixerGraphV21['edges'][number],
	renderTrackIds: ReadonlySet<string>,
	targetTrackIds: ReadonlySet<string>,
	nodeIds: ReadonlySet<string>,
	programmeNodeIds: ReadonlySet<string>,
	detectorEdgeIds: ReadonlySet<string>,
	renderEffects: boolean,
): boolean {
	if (edge.source.kind === 'track' && !renderTrackIds.has(edge.source.id)) return false;
	if (edge.source.kind === 'track' && !targetTrackIds.has(edge.source.id)
		&& !detectorEdgeIds.has(edge.id)) return false;
	if (edge.source.kind === 'mixer-node' && (!nodeIds.has(edge.source.id)
		|| !programmeNodeIds.has(edge.source.id) && !detectorEdgeIds.has(edge.id))) return false;
	if (edge.destination.kind === 'mixer-node' && !nodeIds.has(edge.destination.id)) return false;
	if (edge.destination.kind !== 'effect-sidechain') return true;
	if (!renderEffects) return false;
	if (detectorEdgeIds.has(edge.id)) return true;
	const strip = edge.destination.strip;
	if (strip.kind === 'master') return false;
	if (strip.kind === 'track') return targetTrackIds.has(strip.id);
	return nodeIds.has(strip.id);
}

function reconcileMixRenderRequirementsV21(
	snapshot: MutableMixRenderProjectV21,
): MutableMixRenderProjectV21 {
	projectTransientRenderFeatures(snapshot);
	return snapshot;
}

function laneSurvivesMixSnapshot(
	value: unknown,
	trackIds: ReadonlySet<string>,
	nodeIds: ReadonlySet<string>,
	edgeIds: ReadonlySet<string>,
): boolean {
	const address = dataRecord(dataRecord(value, 'automation lane').address, 'automation lane address');
	if (address.kind === 'edge') return edgeIds.has(String(address.edgeId));
	if (address.kind !== 'strip' && address.kind !== 'effect') return false;
	const strip = dataRecord(address.strip, 'automation lane strip');
	if (strip.kind === 'master') return false;
	if (strip.kind === 'track') return trackIds.has(String(strip.id));
	return strip.kind === 'mixer-node' && nodeIds.has(String(strip.id));
}

function laneTargetsTrack(value: unknown, trackId: string): boolean {
	const address = dataRecord(dataRecord(value, 'automation lane').address, 'automation lane address');
	if (address.kind !== 'strip' && address.kind !== 'effect') return false;
	const strip = dataRecord(address.strip, 'automation lane strip');
	return strip.kind === 'track' && strip.id === trackId;
}

function laneTargetsEffect(value: unknown): boolean {
	return dataRecord(dataRecord(value, 'automation lane').address, 'automation lane address').kind === 'effect';
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function cloneProject(project: ControllerProject): MutableControllerProject {
	if (typeof structuredClone === 'function') return structuredClone(project) as MutableControllerProject;
	return JSON.parse(JSON.stringify(project)) as MutableControllerProject;
}
