/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from './automation-lane-v21.ts';
import { isMixerGraphV21Surface } from './mixer-graph-surface-v21.ts';
import { mixerDetectorInputClosure } from './mixer-detector-input-closure.ts';
import { mixerEndpointKeyV21, normalizeMixerGraphV21, type MixerEdgeV21 } from './mixer-graph-v21.ts';
import type { StripRef } from './parameter-address.ts';

type Data = Readonly<Record<string, unknown>>;

/** Remove foreign programme strips without changing the chosen detector graph. */
export function exportSequenceMixer(project: unknown, trackIds: ReadonlySet<string>): Data {
	return sequenceMixer(record(project), trackIds, false);
}

/** Validate at delivery admission; UI projections do not execute audio. */
export function assertSequenceMixerDependencies(project: unknown, trackIds: ReadonlySet<string>): void {
	sequenceMixer(record(project), trackIds, true);
}

function sequenceMixer(project: Data, trackIds: ReadonlySet<string>, strict: boolean): Data {
	if (!isMixerGraphV21Surface(project.mixer)) return {};
	const tracks = records(project.tracks);
	if (tracks.every(track => track.type !== 'audio' || trackIds.has(String(track.id)))) return {};
	const graph = normalizeMixerGraphV21(project.mixer);
	const strips = new Map<string, Data>(tracks.map(track => [`track:${String(track.id)}`, track]));
	for (const node of [...graph.groups, ...graph.sends, ...graph.cues]) strips.set(`mixer-node:${node.id}`, { effectsActive: node.effectsActive, effects: node.effects });
	strips.set('master', record(project.master));
	const activeEffect = (edge: MixerEdgeV21): boolean => {
		if (edge.destination.kind !== 'effect-sidechain') return true;
		const host = strips.get(mixerEndpointKeyV21(edge.destination.strip));
		return host?.effectsActive !== false && records(host?.effects).some(effect =>
			effect.id === (edge.destination.kind === 'effect-sidechain' ? edge.destination.effectId : '')
			&& effect.enabled !== false && effect.bypassed !== true);
	};
	const active = { ...graph, edges: graph.edges.filter(edge => edge.enabled && activeEffect(edge)) };
	const programme = new Set(['master', ...[...trackIds].map(id => `track:${id}`)]);
	const audibleEdges = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of active.edges) {
			if (edge.destination.kind === 'effect-sidechain' || !programme.has(mixerEndpointKeyV21(edge.source))) continue;
			audibleEdges.add(edge.id);
			if (edge.destination.kind === 'output') continue;
			const destination = mixerEndpointKeyV21(edge.destination);
			if (!programme.has(destination)) { programme.add(destination); changed = true; }
		}
	}
	const retained = new Set(programme);
	for (const edge of active.edges) {
		if (edge.destination.kind !== 'effect-sidechain' || !programme.has(mixerEndpointKeyV21(edge.destination.strip))) continue;
		const incoming = mixerDetectorInputClosure(active, edge.source);
		if (strict && [...incoming.strips].some(strip => strip.startsWith('track:') && !trackIds.has(strip.slice(6)))) {
			throw new RangeError('This sequence uses an audio detector from another timeline. Move its detector recording into the delivered timeline before exporting.');
		}
		audibleEdges.add(edge.id);
		for (const id of incoming.edgeIds) audibleEdges.add(id);
		for (const strip of incoming.strips) if (!strip.startsWith('track:') || trackIds.has(strip.slice(6))) retained.add(strip);
	}
	const keepStrip = (strip: StripRef): boolean => retained.has(mixerEndpointKeyV21(strip));
	const edges = graph.edges.filter(edge => keepStrip(edge.source)
		&& (edge.destination.kind === 'output' || keepStrip(edge.destination.kind === 'effect-sidechain' ? edge.destination.strip : edge.destination)))
		.map(edge => audibleEdges.has(edge.id) ? edge : { ...edge, level: 0 });
	const nodeIds = new Set([...retained].filter(key => key.startsWith('mixer-node:')).map(key => key.slice(11)));
	const mixer = normalizeMixerGraphV21({ ...graph, edges,
		groups: graph.groups.filter(node => nodeIds.has(node.id)), sends: graph.sends.filter(node => nodeIds.has(node.id)),
		cues: graph.cues.filter(node => nodeIds.has(node.id)),
		vcas: graph.vcas.map(vca => ({ ...vca, members: vca.members.filter(keepStrip) })),
	});
	const edgeIds = new Set(edges.map(edge => edge.id));
	return { mixer, ...(Array.isArray(project.automationLanes) ? {
		automationLanes: project.automationLanes.filter(value => {
			const { address } = normalizeAutomationLaneV21(value);
			return address.kind === 'edge' ? audibleEdges.has(address.edgeId) && edgeIds.has(address.edgeId) : keepStrip(address.strip);
		}),
	} : {}) };
}

function record(value: unknown): Data { return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}; }
function records(value: unknown): readonly Data[] { return Array.isArray(value) ? value.map(record) : []; }
