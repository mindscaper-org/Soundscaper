/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MixerEdgeV21, MixerGraphV21 } from '../../mixer-graph-v21.ts';
import type { StripRef } from '../../parameter-address.ts';
import { effectSupportsExplicitSidechain } from '../../effect-explicit-sidechain-capability.ts';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY, type SoundscaperRoutingGraphCopy } from './soundscaper-routing-graph-copy.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';

type DataRecord = Readonly<Record<string, unknown>>;
export interface RoutingEndpointOption<Endpoint> { readonly value: string; readonly label: string; readonly endpoint: Endpoint }
const NODE_COLLECTIONS = [['groups', 'group'], ['sends', 'send'], ['cues', 'cue']] as const;
const fill = formatLocalizedTemplate;

export function routingSourceOptions(projectValue: unknown, graph: MixerGraphV21, copy: SoundscaperRoutingGraphCopy = SOUNDSCAPER_ROUTING_GRAPH_COPY): readonly RoutingEndpointOption<MixerEdgeV21['source']>[] {
	const options: RoutingEndpointOption<MixerEdgeV21['source']>[] = [];
	for (const track of audioTracks(projectValue)) options.push(endpointOption({ kind: 'track', id: track.id }, fill(copy.endpointLabel, { kind: copy.track, name: track.name })));
	for (const [collection, kind] of NODE_COLLECTIONS) for (const node of graph[collection]) options.push(endpointOption({ kind: 'mixer-node', id: node.id }, fill(copy.endpointLabel, { kind: copy[kind], name: node.name || node.id })));
	options.push(endpointOption({ kind: 'master' }, copy.master));
	return options;
}
export function routingDestinationOptions(projectValue: unknown, graph: MixerGraphV21, copy: SoundscaperRoutingGraphCopy = SOUNDSCAPER_ROUTING_GRAPH_COPY): readonly RoutingEndpointOption<MixerEdgeV21['destination']>[] {
	const options: RoutingEndpointOption<MixerEdgeV21['destination']>[] = [];
	for (const [collection, kind] of NODE_COLLECTIONS) for (const node of graph[collection]) options.push(endpointOption({ kind: 'mixer-node' as const, id: node.id }, fill(copy.endpointLabel, { kind: copy[kind], name: node.name || node.id })));
	options.push(endpointOption({ kind: 'master' as const }, copy.master));
	for (const output of graph.outputs) options.push(endpointOption({ kind: 'output' as const, id: output.id }, fill(copy.endpointLabel, { kind: copy.output, name: output.name || output.id })));
	for (const track of audioTracks(projectValue)) pushSidechains(options, { kind: 'track', id: track.id }, fill(copy.endpointStrip, { kind: copy.track, name: track.name }), track.effects, copy);
	const master = record(record(projectValue)?.master);
	pushSidechains(options, { kind: 'master' }, copy.master, records(master?.effects), copy);
	for (const [collection, kind] of NODE_COLLECTIONS) for (const node of graph[collection]) pushSidechains(options, { kind: 'mixer-node', id: node.id }, fill(copy.endpointStrip, { kind: copy[kind], name: node.name || node.id }), node.effects, copy);
	return options;
}
export function routingVcaMemberOptions(projectValue: unknown, graph: MixerGraphV21, copy: SoundscaperRoutingGraphCopy = SOUNDSCAPER_ROUTING_GRAPH_COPY): readonly RoutingEndpointOption<StripRef>[] {
	return routingSourceOptions(projectValue, graph, copy).map(({ value, label, endpoint }) => ({ value, label, endpoint }));
}
export function routingEndpointValue(endpoint: MixerEdgeV21['source'] | MixerEdgeV21['destination'] | StripRef): string { return JSON.stringify(endpoint); }
function endpointOption<Endpoint extends Readonly<Record<string, unknown>>>(endpoint: Endpoint, label: string): RoutingEndpointOption<Endpoint> {
	return Object.freeze({ endpoint: Object.freeze(endpoint), value: routingEndpointValue(endpoint as never), label });
}
function pushSidechains(options: RoutingEndpointOption<MixerEdgeV21['destination']>[], strip: StripRef, stripLabel: string, effects: readonly DataRecord[], copy: SoundscaperRoutingGraphCopy): void {
	for (const effect of effects) if (typeof effect.id === 'string' && effect.id.length > 0 && effectSupportsExplicitSidechain(effect)) options.push(endpointOption({ kind: 'effect-sidechain' as const, strip, effectId: effect.id }, fill(copy.sidechainEndpoint, { kind: copy.sidechain, strip: stripLabel, effect: String(effect.name ?? effect.type ?? effect.id) })));
}
function audioTracks(projectValue: unknown): readonly { id: string; name: string; effects: readonly DataRecord[] }[] {
	return records(record(projectValue)?.tracks).flatMap(track => track.type === 'audio' && typeof track.id === 'string' && track.id.length > 0 ? [{ id: track.id, name: typeof track.name === 'string' && track.name ? track.name : track.id, effects: records(track.effects) }] : []);
}
function record(value: unknown): DataRecord | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null; }
function records(value: unknown): DataRecord[] { return Array.isArray(value) ? value.map(record).filter((entry): entry is DataRecord => entry !== null) : []; }
