/* SPDX-License-Identifier: AGPL-3.0-only */

import { defaultMixerChannelMapV21, mixerEndpointKeyV21, type MixerEdgeV21, type MixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import type { StripRef } from '../common/editor/parameter-address.ts';
import { resolveTerminalChannelWidths } from '../common/editor/terminal-channel-widths.ts';
import type { SoundscaperProject } from './editor-project.ts';

interface Effect {
	readonly id: string;
	readonly type: string;
	readonly context?: Readonly<Record<string, unknown>> | null;
}
interface Rack {
	readonly strip: StripRef;
	readonly width: number;
	readonly effects: readonly Effect[];
}

/**
 * The rack's Control Track selector authors the production graph. Reconcile it
 * in the effect command transaction, including copy/paste, so its context and
 * explicit detector route share one Undo operation.
 */
export function reconcileAutoDuckControlRoutes(previous: SoundscaperProject,
	projectValue: Readonly<Record<string, unknown>>, graph: MixerGraphV21): MixerGraphV21 {
	const project = projectValue as unknown as SoundscaperProject;
	const widths = resolveTerminalChannelWidths(project, project.masterChannels).tracks;
	const previousControls = new Map(racks(previous, previous.mixer).flatMap(rack => rack.effects.map(effect =>
		[effect.id, effect.context?.controlTrackId] as const)));
	let edges = [...graph.edges];
	for (const rack of racks(project, graph)) for (const effect of rack.effects) {
		if (effect.type !== 'audacity-auto-duck') continue;
		const control = effect.context?.controlTrackId;
		if (typeof control !== 'string' || !project.tracks.some(track => track.id === control && track.type === 'audio')) continue;
		const targetsEffect = (edge: MixerEdgeV21) => edge.destination.kind === 'effect-sidechain'
			&& edge.destination.effectId === effect.id
			&& mixerEndpointKeyV21(edge.destination.strip) === mixerEndpointKeyV21(rack.strip);
		const assigned = edges.filter(targetsEffect);
		const changedControl = previousControls.has(effect.id) && previousControls.get(effect.id) !== control;
		// An unchanged selector cannot rewrite advanced routing authored elsewhere.
		if (assigned.length > 0 && !changedControl) continue;
		if (assigned.length === 1 && assigned[0]!.source.kind === 'track' && assigned[0]!.source.id === control) continue;
		const existing = assigned[0];
		const sourceWidth = widths.get(control) ?? project.masterChannels;
		const retainedMap = existing && (existing.channelMap.length === 0 || existing.channelMap.length === rack.width
			&& existing.channelMap.every(channel => channel >= -1 && channel < sourceWidth));
		let id = existing?.id ?? `sidechain:auto-duck:${effect.id}`;
		while (!existing && edges.some(edge => edge.id === id)) id += ':';
		const route: MixerEdgeV21 = { id, kind: 'sidechain', source: { kind: 'track', id: control },
			destination: { kind: 'effect-sidechain', strip: rack.strip, effectId: effect.id },
			position: existing?.position ?? 'pre-fader', level: existing?.level ?? 1, enabled: existing?.enabled ?? true,
			channelMap: retainedMap ? existing.channelMap : defaultMixerChannelMapV21(sourceWidth, rack.width) };
		edges = [...edges.filter(edge => !targetsEffect(edge)), route];
	}
	return { ...graph, edges };
}

function racks(project: SoundscaperProject, graph: MixerGraphV21): readonly Rack[] {
	const widths = resolveTerminalChannelWidths(project, project.masterChannels).tracks;
	return [
		{ strip: { kind: 'master' }, width: project.masterChannels, effects: project.master.effects },
		...project.tracks.filter(track => track.type === 'audio').map(track => ({
			strip: { kind: 'track' as const, id: track.id }, width: widths.get(track.id) ?? project.masterChannels,
			effects: track.effects ?? [],
		})),
		...[...graph.groups, ...graph.sends, ...graph.cues].map(bus => ({
			strip: { kind: 'mixer-node' as const, id: bus.id }, width: bus.channelCount,
			effects: bus.effects.filter((effect): effect is Readonly<Record<string, unknown>> & Effect =>
				typeof effect.id === 'string' && typeof effect.type === 'string'),
		})),
	];
}
