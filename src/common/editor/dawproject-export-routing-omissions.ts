/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioTrackChannelCount } from './project-audio-factory.js';
import { defaultMixerChannelMapV21 } from './mixer-graph-v21.ts';
import { addDeliveryReportItem } from './delivery-report.ts';
import { record, records, type DataRecord, type DawprojectExportContext } from './dawproject-export-context.ts';
import { frozenRecordIdIndex, hasOwnDataValue } from './frozen-record-id-index.ts';

/** Channel.destination carries an address, not a weighted, mapped or pre-fader connection. */
export function reportOmittedDawprojectRouting(context: DawprojectExportContext): void {
	const graph = record(context.project.mixer);
	if (graph.schemaVersion !== 1) return;
	const tracks = new Map(records(context.project.tracks).map(track => [String(track.id), track]));
	const groupOwner = graph.groups, sendOwner = graph.sends;
	const groups = records(groupOwner);
	const sends = records(sendOwner);
	const nodes = new Map([...groups, ...sends].map(node => [String(node.id), node]));
	const groupIndex = immutableIds(groupOwner), sendIndex = immutableIds(sendOwner);
	const outputOwner: unknown = Object.getOwnPropertyDescriptor(graph, 'outputs')?.value;
	const outputIndex = immutableIds(outputOwner);
	const mainOutputs = outputIndex ? immutableMainOutputs(outputOwner as readonly DataRecord[]) : null;
	const sameOutputs = (): boolean => Boolean(outputIndex && hasOwnDataValue(graph, 'outputs', outputOwner));
	const mainOutput = (destination: DataRecord): boolean => {
		const id = ownEndpointId(destination);
		return id !== undefined && sameOutputs() && mainOutputs ? mainOutputs.has(id)
			: records(graph.outputs).some(output => output.id === destination.id && output.role === 'main');
	};
	const masterChannels = positiveWidth(context.project.masterChannels, 2);
	const endpoint = (value: DataRecord): { name: string; width: number } | null => {
		if (value.kind === 'master') return { name: 'Master', width: masterChannels };
		if (value.kind === 'output') {
			const id = ownEndpointId(value);
			const output = id !== undefined && sameOutputs() ? outputIndex!.get(id)
				: records(graph.outputs).find(candidate => candidate.id === value.id);
			return output ? { name: String(output.name), width: positiveWidth(output.channelCount, masterChannels) } : null;
		}
		const item = value.kind === 'track' ? tracks.get(String(value.id)) : nodes.get(String(value.id));
		if (!item) return null;
		return { name: String(item.name ?? item.id), width: value.kind === 'track'
			? (context.readAudioTrackChannels?.(item, masterChannels) ?? audioTrackChannelCount(context.project, item, masterChannels))
			: positiveWidth(item.channelCount, masterChannels) };
	};
	for (const edge of records(graph.edges)) {
		const source = record(edge.source);
		const destination = record(edge.destination);
		const from = endpoint(source);
		const to = endpoint(destination);
		// Omitted processors/nodes already have their own scoped warnings.
		if (!from || !to) continue;
		const supportedSend = edge.kind === 'send' && destination.kind === 'mixer-node'
			&& hasEndpointId(sends, sendIndex, destination);
		const supportedAssignment = edge.kind === 'assignment'
			&& (destination.kind === 'master' || destination.kind === 'output' && mainOutput(destination)
				|| hasEndpointId(groups, groupIndex, destination));
		const features: string[] = [];
		if (!supportedSend && !supportedAssignment) features.push('connection');
		if (edge.enabled === false) features.push('enabled');
		if (!supportedSend && Number(edge.level ?? 1) !== 1) features.push('level');
		if (!supportedSend && edge.position === 'pre-fader') features.push('position');
		const expectedMap = defaultMixerChannelMapV21(from.width, to.width);
		const statedMap = Array.isArray(edge.channelMap) ? edge.channelMap : expectedMap;
		if (statedMap.length !== expectedMap.length
			|| statedMap.some((channel, index) => channel !== expectedMap[index])) features.push('channelMap');
		if (features.length === 0) continue;
		const level = Number(edge.level ?? 1);
		const levelDescription = features.includes('level')
			? ` Connection level ${decibelLabel(level)} is omitted; the destination uses unity (0 dB).` : '';
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.routing-features-omitted', disposition: 'omitted', severity: 'warning',
			scope: { kind: 'mixer-edge', id: String(edge.id) },
			data: { features, source: edge.source, destination: edge.destination,
				level, position: edge.position, enabled: edge.enabled, channelMap: statedMap },
			message: `${from.name} → ${to.name}: DAWproject cannot retain this connection's ${features.join(', ')}.${levelDescription}`,
		});
	}
}

function ownEndpointId(value: DataRecord): string | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(value, 'id');
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value : undefined;
}

function hasEndpointId(items: readonly DataRecord[], index: ReadonlyMap<string, DataRecord> | null, endpoint: DataRecord): boolean {
	const id = ownEndpointId(endpoint);
	return id !== undefined && index ? index.has(id) : items.some(item => item.id === endpoint.id);
}

function immutableIds(value: unknown): ReadonlyMap<string, DataRecord> | null {
	return Array.isArray(value) ? frozenRecordIdIndex(value as readonly (DataRecord & { readonly id: string })[]) : null;
}

function immutableMainOutputs(outputs: readonly DataRecord[]): ReadonlySet<string> | null {
	const result = new Set<string>();
	for (const output of outputs) {
		const role = Object.getOwnPropertyDescriptor(output, 'role');
		if (!role || !Object.hasOwn(role, 'value')) return null;
		if (role.value === 'main') result.add(output.id as string);
	}
	return result;
}

function positiveWidth(value: unknown, fallback: number): number {
	const width = Number(value);
	return Number.isSafeInteger(width) && width > 0 ? width : fallback;
}

function decibelLabel(level: number): string {
	if (level === 0) return '−∞ dB';
	return `${String(Number((20 * Math.log10(level)).toFixed(6))).replace('-', '−')} dB`;
}
