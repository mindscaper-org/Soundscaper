/* SPDX-License-Identifier: AGPL-3.0-only */

/** Programme audio authority for the delivered Framescaper sequence. */

import {
	mixerEndpointKeyV21,
	normalizeMixerGraphV21,
	type MixerGraphV21,
} from '../common/editor/mixer-graph-v21.ts';
import type { FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

type DataRecord = Record<string, unknown>;

export interface FramescaperSequenceAudioAuthorityScopeV15 {
	/** The delivered sequence's clip-bearing audio tracks, sorted for binding. */
	readonly audioTrackIds: readonly string[];
	readonly mixer: MixerGraphV21;
	readonly automationLanes: readonly DataRecord[];
}

/**
 * Project the delivered sequence's clip-bearing audio tracks, reachable mixer
 * paths and automation into its picture plan. A silent picture still carries
 * master and output authority. Cross-sequence sidechains outside those paths
 * cannot affect the delivered pixels and are omitted.
 */
export function framescaperSequenceAudioAuthorityScopeV15(
	project: FramescaperProjectNativeMedia,
	sequenceId: string,
): FramescaperSequenceAudioAuthorityScopeV15 {
	const sequences = records(project.sequences, 'Framescaper sequences');
	const selected = uniqueRecordById(sequences, sequenceId, 'selected Framescaper sequence');
	const trackById = uniqueRecordsById(records(project.tracks, 'Framescaper tracks'), 'Framescaper track');
	const audioClipIds = new Set(records(project.clips, 'Framescaper clips')
		.filter(({ kind }) => kind === 'audio').map((clip) => id(clip, 'Framescaper clip')));
	const programme = strings(selected.trackIds, 'selected Framescaper sequence track IDs')
		.map((trackId) => trackById.get(trackId))
		.filter((track): track is DataRecord => track !== undefined && track.type === 'audio'
			&& strings(track.clipIds, 'audio track clip IDs').some((clipId) => audioClipIds.has(clipId)));
	const audioTrackIds = sortedIds(programme, 'sequence audio track');
	const scope = selectedMixerGraph(normalizeMixerGraphV21(project.mixer), audioTrackIds);
	return Object.freeze({
		audioTrackIds: Object.freeze(audioTrackIds),
		mixer: scope.graph,
		automationLanes: Object.freeze(records(project.automationLanes, 'automation lanes')
			.filter((lane) => laneSurvivesScope(lane, scope))),
	});
}

interface SelectedMixerGraphScope {
	readonly graph: MixerGraphV21;
	readonly edgeIds: ReadonlySet<string>;
	readonly stripKeys: ReadonlySet<string>;
}

function selectedMixerGraph(
	graph: MixerGraphV21,
	trackIds: readonly string[],
): SelectedMixerGraphScope {
	const reachable = new Set([...trackIds.map((trackId) => `track:${trackId}`), 'master']);
	const includedEdgeIds = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of graph.edges) {
			if (!edge.enabled || edge.kind === 'sidechain' || !reachable.has(mixerEndpointKeyV21(edge.source))) continue;
			if (!includedEdgeIds.has(edge.id)) {
				includedEdgeIds.add(edge.id);
				changed = true;
			}
			if (edge.destination.kind !== 'output' && edge.destination.kind !== 'effect-sidechain') {
				const destination = mixerEndpointKeyV21(edge.destination);
				if (!reachable.has(destination)) {
					reachable.add(destination);
					changed = true;
				}
			}
		}
	}
	for (const edge of graph.edges) {
		if (!edge.enabled || edge.kind !== 'sidechain'
			|| edge.destination.kind !== 'effect-sidechain'
			|| !reachable.has(stripKey(edge.destination.strip))
			|| !reachable.has(mixerEndpointKeyV21(edge.source))) continue;
		includedEdgeIds.add(edge.id);
	}
	const nodeIds = new Set([...reachable].flatMap((key) => (
		key.startsWith('mixer-node:') ? [key.slice('mixer-node:'.length)] : []
	)));
	const strips = new Set([...reachable].filter((key) => (
		key === 'master' || key.startsWith('track:') || key.startsWith('mixer-node:')
	)));
	const scoped = normalizeMixerGraphV21({
		schemaVersion: graph.schemaVersion,
		groups: graph.groups.filter(({ id }) => nodeIds.has(id)),
		sends: graph.sends.filter(({ id }) => nodeIds.has(id)),
		cues: graph.cues.filter(({ id }) => nodeIds.has(id)),
		vcas: graph.vcas.flatMap((vca) => {
			const members = vca.members.filter((member) => strips.has(stripKey(member)));
			return members.length === 0 ? [] : [{ ...vca, members }];
		}),
		outputs: graph.outputs,
		edges: graph.edges.filter(({ id }) => includedEdgeIds.has(id)),
	});
	return Object.freeze({ graph: scoped, edgeIds: includedEdgeIds, stripKeys: strips });
}

function laneSurvivesScope(lane: DataRecord, scope: SelectedMixerGraphScope): boolean {
	const address = record(lane.address, 'automation lane address');
	if (address.kind === 'edge') return scope.edgeIds.has(idValue(address.edgeId, 'automation edge ID'));
	if (address.kind !== 'strip' && address.kind !== 'effect') return false;
	return scope.stripKeys.has(stripKey(record(address.strip, 'automation strip')));
}

function stripKey(strip: DataRecord | Readonly<{ kind: string; id?: string }>): string {
	if (strip.kind === 'master') return 'master';
	return `${String(strip.kind)}:${idValue(strip.id, 'mixer strip ID')}`;
}

function uniqueRecordById(values: readonly DataRecord[], targetId: string, name: string): DataRecord {
	const matches = values.filter((value) => id(value, name) === targetId);
	if (matches.length !== 1) throw new ReferenceError(`${name} ${targetId} must exist exactly once.`);
	return matches[0]!;
}

function uniqueRecordsById(values: readonly DataRecord[], name: string): ReadonlyMap<string, DataRecord> {
	const result = new Map<string, DataRecord>();
	for (const value of values) {
		const valueId = id(value, name);
		if (result.has(valueId)) throw new RangeError(`Duplicate ${name} ID ${valueId}.`);
		result.set(valueId, value);
	}
	return result;
}

function sortedIds(values: readonly DataRecord[], name: string): string[] {
	// Code-unit order: these ids land in fingerprinted authority payloads, and
	// two machines' ICU locales must never derive two different fingerprints.
	return values.map((value) => id(value, name)).sort();
}

function strings(value: unknown, name: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry) => idValue(entry, name));
}

function records(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry, index) => record(entry, `${name}[${String(index)}]`));
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function id(value: DataRecord, name: string): string {
	return idValue(value.id, `${name} ID`);
}

function idValue(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} is invalid.`);
	return value;
}
