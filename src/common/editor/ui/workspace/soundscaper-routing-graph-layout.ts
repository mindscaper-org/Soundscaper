/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	mixerEndpointKeyV21,
	type MixerEdgeV21,
	type MixerGraphV21,
	type MixerNodeKindV21,
} from '../../mixer-graph-v21.ts';
import { routingLayoutRanks } from './routing-layout-ranks.ts';
import { resolveTerminalChannelWidths } from '../../terminal-channel-widths.ts';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../../../i18n/editor-soundscaper-routing-graph-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';

type DataRecord = Readonly<Record<string, unknown>>;
export type RoutingLayoutNodeKind = 'track' | MixerNodeKindV21 | 'master' | 'output' | 'vca';

export interface RoutingLayoutNode {
	readonly key: string;
	readonly id: string;
	readonly kind: RoutingLayoutNodeKind;
	readonly label: string;
	readonly detail: string;
	readonly channelCount: number | null;
	readonly rank: number;
	readonly rail: 'audio' | 'control';
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface RoutingLayoutEdge {
	readonly key: string;
	readonly id: string;
	readonly kind: MixerEdgeV21['kind'] | 'vca-membership';
	readonly sourceKey: string;
	readonly destinationKey: string;
	readonly enabled: boolean;
	readonly parallelOffset: number;
	readonly path: string;
}

export interface SoundscaperRoutingGraphLayout {
	readonly nodes: readonly RoutingLayoutNode[];
	readonly edges: readonly RoutingLayoutEdge[];
	readonly width: number;
	readonly height: number;
}

interface PendingNode {
	readonly key: string;
	readonly id: string;
	readonly kind: RoutingLayoutNodeKind;
	readonly label: string;
	readonly detail: string;
	readonly channelCount: number | null;
	readonly semanticOrder: number;
	readonly rail: 'audio' | 'control';
	readonly initialRank: number;
}

const CARD_WIDTH = 184;
const CARD_HEIGHT = 78;
const COLUMN_GAP = 76;
const ROW_GAP = 30;
const GRAPH_PADDING = 32;
const CONTROL_Y = 28;

export function layoutSoundscaperRoutingGraph(
	projectValue: unknown,
	graph: MixerGraphV21,
	copy: Readonly<Record<string, string | undefined>> = {},
): SoundscaperRoutingGraphLayout {
	const text = resolveEditorCopyScope('routing', SOUNDSCAPER_ROUTING_GRAPH_COPY, copy);
	const project = record(projectValue);
	const masterChannels = positiveInteger(project?.masterChannels, 2);
	const terminalWidths = resolveTerminalChannelWidths(projectValue as never, masterChannels);
	const pending: PendingNode[] = [];
	let semanticOrder = 0;
	for (const track of records(project?.tracks)) {
		if (track.type !== 'audio' || typeof track.id !== 'string' || track.id.length === 0) continue;
		pending.push({
			key: `track:${track.id}`, id: track.id, kind: 'track',
			label: label(track.name, track.id), detail: text.track,
			channelCount: terminalWidths.tracks.get(track.id) ?? masterChannels,
			semanticOrder: semanticOrder++, rail: 'audio', initialRank: 0,
		});
	}
	for (const [collection, kind] of NODE_COLLECTIONS) {
		for (const node of graph[collection]) pending.push({
			key: `mixer-node:${node.id}`, id: node.id, kind,
			label: node.name || node.id, detail: text[kind], channelCount: node.channelCount,
			semanticOrder: semanticOrder++, rail: 'audio', initialRank: 1,
		});
	}
	pending.push({
		key: 'master', id: 'master', kind: 'master', label: text.master, detail: text.master,
		channelCount: masterChannels, semanticOrder: semanticOrder++, rail: 'audio', initialRank: 1,
	});
	for (const output of graph.outputs) pending.push({
		key: `output:${output.id}`, id: output.id, kind: 'output',
		label: output.name || output.id, detail: outputDetail(output.role, text),
		channelCount: output.channelCount, semanticOrder: semanticOrder++, rail: 'audio', initialRank: 2,
	});
	const controlById = new Map<string, PendingNode>();
	for (const vca of graph.vcas) {
		const node: PendingNode = {
		key: `vca:${vca.id}`, id: vca.id, kind: 'vca', label: vca.name || vca.id,
		detail: (vca.members.length === 1 ? text.memberCountOne : text.memberCountMany).replace('{count}', String(vca.members.length)),
		channelCount: null, semanticOrder: semanticOrder++, rail: 'control', initialRank: 0,
		};
		pending.push(node);
		if (!controlById.has(vca.id)) controlById.set(vca.id, node);
	}

	const initialRank = new Map<string, number>();
	const orderIndex = new Map<string, number>();
	for (const node of pending) {
		if (node.rail === 'audio') initialRank.set(node.key, node.initialRank);
		orderIndex.set(node.key, node.semanticOrder);
	}
	const predecessors = new Map<string, string[]>();
	const parallels = new Map<string, { count: number; seen: number }>();
	const visibleEdges: { edge: MixerEdgeV21; sourceKey: string; destinationKey: string; parallel: { count: number; seen: number } }[] = [];
	for (const edge of graph.edges) {
		const sourceKey = routingLayoutNodeKeyForEndpoint(edge.source);
		const destinationKey = routingLayoutNodeKeyForEndpoint(edge.destination);
		if (!initialRank.has(sourceKey) || !initialRank.has(destinationKey)) continue;
		const key = `${sourceKey}\u0000${destinationKey}`;
		let parallel = parallels.get(key);
		if (!parallel) {
			parallel = { count: 0, seen: 0 };
			parallels.set(key, parallel);
		}
		parallel.count += 1;
		visibleEdges.push({ edge, sourceKey, destinationKey, parallel });
		if (!edge.enabled || edge.kind === 'sidechain') continue;
		const entries = predecessors.get(destinationKey);
		if (entries) entries.push(sourceKey);
		else predecessors.set(destinationKey, [sourceKey]);
	}
	const rank = routingLayoutRanks(initialRank, predecessors, pending.length);

	const byRank = new Map<number, PendingNode[]>();
	for (const node of pending) {
		if (node.rail !== 'audio') continue;
		const nodeRank = rank.get(node.key) ?? node.initialRank;
		const entries = byRank.get(nodeRank);
		if (entries) entries.push(node);
		else byRank.set(nodeRank, [node]);
	}
	const orderedRanks = [...byRank].sort(([left], [right]) => left - right);
	for (const [nodeRank, entries] of orderedRanks) {
		if (nodeRank === 0) continue;
		const medians = new Map<string, number>();
		for (const { key } of entries) medians.set(key, predecessorMedian(predecessors.get(key), orderIndex));
		entries.sort((left, right) => medians.get(left.key)! - medians.get(right.key)! || left.semanticOrder - right.semanticOrder);
		entries.forEach((node, index) => orderIndex.set(node.key, index));
	}

	const hasControlRail = graph.vcas.length > 0;
	const audioY = hasControlRail ? CONTROL_Y + CARD_HEIGHT + 66 : GRAPH_PADDING;
	const positioned: RoutingLayoutNode[] = [];
	for (const [nodeRank, entries] of orderedRanks) {
		entries.forEach((node, row) => positioned.push(positionedNode(
			node, nodeRank,
			GRAPH_PADDING + nodeRank * (CARD_WIDTH + COLUMN_GAP),
			audioY + row * (CARD_HEIGHT + ROW_GAP),
		)));
	}
	graph.vcas.forEach((vca, index) => {
		const node = controlById.get(vca.id)!;
		positioned.push(positionedNode(
			node, 0, GRAPH_PADDING + index * (CARD_WIDTH + 18), CONTROL_Y,
		));
	});
	// The rank/row walk already emits audio nodes in increasing X then Y,
	// followed by the controls in their horizontal display order.
	const nodeByKey = new Map<string, RoutingLayoutNode>();
	let width = 640, height = 300;
	for (const node of positioned) {
		nodeByKey.set(node.key, Object.freeze(node));
		width = Math.max(width, node.x + node.width + GRAPH_PADDING);
		height = Math.max(height, node.y + node.height + GRAPH_PADDING);
	}
	const edges: RoutingLayoutEdge[] = [];
	for (const { edge, sourceKey, destinationKey, parallel } of visibleEdges) {
		const source = nodeByKey.get(sourceKey)!;
		const destination = nodeByKey.get(destinationKey)!;
		const parallelOffset = (parallel.seen++ - (parallel.count - 1) / 2) * 24;
		edges.push(Object.freeze({
			key: `edge:${edge.id}`, id: edge.id, kind: edge.kind, sourceKey, destinationKey,
			enabled: edge.enabled, parallelOffset, path: curvePath(source, destination, parallelOffset),
		}));
	}
	for (const vca of graph.vcas) {
		const sourceKey = `vca:${vca.id}`;
		const source = nodeByKey.get(sourceKey);
		if (!source) continue;
		for (const [index, member] of vca.members.entries()) {
			const destinationKey = mixerEndpointKeyV21(member);
			const destination = nodeByKey.get(destinationKey);
			if (!destination) continue;
			edges.push(Object.freeze({
				key: `vca:${vca.id}:${destinationKey}:${index}`, id: vca.id,
				kind: 'vca-membership', sourceKey, destinationKey, enabled: true,
				parallelOffset: 0,
				path: controlPath(source, destination),
			}));
		}
	}
	return Object.freeze({
		nodes: Object.freeze(positioned),
		edges: Object.freeze(edges),
		width,
		height,
	});
}

export function routingLayoutNodeKeyForEndpoint(endpoint: MixerEdgeV21['source'] | MixerEdgeV21['destination']): string {
	return endpoint.kind === 'effect-sidechain'
		? mixerEndpointKeyV21(endpoint.strip)
		: mixerEndpointKeyV21(endpoint);
}

function positionedNode(node: PendingNode, rank: number, x: number, y: number): RoutingLayoutNode {
	return {
		key: node.key, id: node.id, kind: node.kind, label: node.label,
		detail: node.detail, channelCount: node.channelCount, rank, rail: node.rail,
		x, y, width: CARD_WIDTH, height: CARD_HEIGHT,
	};
}

function curvePath(source: RoutingLayoutNode, destination: RoutingLayoutNode, parallelOffset: number): string {
	const startX = source.x + source.width;
	const startY = source.y + source.height / 2;
	const endX = destination.x;
	const endY = destination.y + destination.height / 2;
	const curve = Math.max(42, Math.abs(endX - startX) * 0.45);
	return `M ${startX} ${startY} C ${startX + curve} ${startY + parallelOffset}, ${endX - curve} ${endY + parallelOffset}, ${endX} ${endY}`;
}

function controlPath(source: RoutingLayoutNode, destination: RoutingLayoutNode): string {
	const startX = source.x + source.width / 2;
	const startY = source.y + source.height;
	const endX = destination.x + destination.width / 2;
	const endY = destination.y;
	const midpointY = startY + Math.max(24, (endY - startY) / 2);
	return `M ${startX} ${startY} C ${startX} ${midpointY}, ${endX} ${midpointY}, ${endX} ${endY}`;
}

function predecessorMedian(predecessors: readonly string[] | undefined, order: ReadonlyMap<string, number>): number {
	if (!predecessors?.length) return Number.MAX_SAFE_INTEGER;
	if (predecessors.length === 1) return order.get(predecessors[0]!) ?? 0;
	const values = predecessors.map(key => order.get(key) ?? 0).sort((left, right) => left - right);
	const middle = Math.floor(values.length / 2);
	return values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!;
}

function outputDetail(role: string, text: Readonly<{ main: string; controlRoom: string; auxiliary: string; outputDescription: string }>): string {
	const name = role === 'main' ? text.main : role === 'control-room' ? text.controlRoom : role === 'auxiliary' ? text.auxiliary : role;
	return text.outputDescription.replace('{role}', name);
}

function label(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function records(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((entry): entry is DataRecord => entry !== null) : [];
}

function positiveInteger(value: unknown, fallback: number): number {
	return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 32 ? Number(value) : fallback;
}

const NODE_COLLECTIONS = [
	['groups', 'group'],
	['sends', 'send'],
	['cues', 'cue'],
] as const;
