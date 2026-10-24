/* SPDX-License-Identifier: AGPL-3.0-only */

import { isMixerGraphV21Surface, isMixerTrackSurfaceAssignmentV21, isMixerTrackSurfaceSendV21,
	type MixerTrackSurfaceRouteV21 } from '../../mixer-graph-surface-v21.ts';
import { normalizeMixerGraphV21, type MixerEdgeV21 } from '../../mixer-graph-v21.ts';
import { resolveTerminalChannelWidths, stereoStripPanAvailable, type TerminalWidthProject } from '../../terminal-channel-widths.ts';
import type { StripRef } from '../../parameter-address.ts';

interface PanelProject extends TerminalWidthProject {
	readonly masterChannels?: number;
	readonly metadata?: Readonly<{ adm?: Readonly<{ mode?: unknown }> }>;
	readonly mixer?: TerminalWidthProject['mixer'];
}

/** One render owns the normalized graph, strip widths, routes and send addresses. */
export function prepareMixerPanelRouting(projectValue: unknown, tracks: readonly Readonly<{ id: string }>[]) {
	const project = projectValue as PanelProject | null | undefined;
	const mixer = project?.mixer;
	const mode = project?.metadata?.adm?.mode;
	if (!isMixerGraphV21Surface(mixer)) return {
		routes: mixer?.routes ?? {},
		panAvailable: (_strip: StripRef) => stereoStripPanAvailable(2, mode),
		sendAddress: (_trackId: string, _sendId: string) => null,
	};
	const masterChannels = project?.masterChannels ?? 2;
	const fallback = Number.isSafeInteger(masterChannels) && masterChannels > 0 ? Math.min(32, masterChannels) : 2;
	const widths = resolveTerminalChannelWidths(project, masterChannels);
	const graph = normalizeMixerGraphV21(mixer);
	const assignments = new Map<string, MixerEdgeV21[]>();
	const sends = new Map<string, Map<string, MixerEdgeV21[]>>();
	for (const edge of graph.edges) {
		if (edge.source.kind !== 'track') continue;
		const id = edge.source.id;
		if (edge.kind === 'assignment') {
			let entries = assignments.get(id);
			if (!entries) { entries = []; assignments.set(id, entries); }
			entries.push(edge);
		} else if (edge.kind === 'send' && edge.destination.kind === 'mixer-node') {
			let destinations = sends.get(id);
			if (!destinations) { destinations = new Map(); sends.set(id, destinations); }
			let entries = destinations.get(edge.destination.id);
			if (!entries) { entries = []; destinations.set(edge.destination.id, entries); }
			entries.push(edge);
		}
	}
	const routes: Record<string, MixerTrackSurfaceRouteV21> = {};
	for (const { id } of tracks) {
		const surfaceWidths = { sourceChannels: widths.tracks.get(id) || masterChannels, masterChannels };
		const entries = assignments.get(id);
		const assignment = entries?.length === 1 && isMixerTrackSurfaceAssignmentV21(graph, entries[0]!, id, surfaceWidths) ? entries[0]! : null;
		const levels: Record<string, number> = {};
		const editableSendIds: string[] = [];
		for (const send of graph.sends) {
			const matching = sends.get(id)?.get(send.id);
			if (!matching?.length) { editableSendIds.push(send.id); continue; }
			if (matching.length !== 1 || !isMixerTrackSurfaceSendV21(graph, matching[0]!, id, send.id, surfaceWidths)) continue;
			Object.defineProperty(levels, send.id, { value: matching[0]!.level, enumerable: true, configurable: true, writable: true });
			editableSendIds.push(send.id);
		}
		Object.defineProperty(routes, id, { value: Object.freeze({ groupId: assignment?.destination.kind === 'mixer-node' ? assignment.destination.id : null,
			sends: Object.freeze(levels), groupEditable: assignment !== null, editableSendIds: Object.freeze(editableSendIds) }), enumerable: true });
	}
	const cues = new Map(graph.cues.map(cue => [cue.id, cue.channelCount]));
	const sendIds = new Map<string, ReadonlyMap<string, string>>();
	for (const [trackId, destinations] of sends) {
		sendIds.set(trackId, new Map([...destinations].map(([id, entries]) => [id, entries[0]!.id])));
	}
	return {
		routes,
		panAvailable(strip: StripRef) {
			const width = strip.kind === 'master' ? fallback : strip.kind === 'track' ? widths.tracks.get(strip.id) ?? 2
				: widths.groups.get(strip.id) ?? widths.sends.get(strip.id) ?? cues.get(strip.id) ?? fallback;
			return stereoStripPanAvailable(width, mode);
		},
		sendAddress(trackId: string, sendId: string) {
			const edgeId = sendIds.get(trackId)?.get(sendId);
			return edgeId ? { kind: 'edge' as const, edgeId, parameterId: 'level' as const } : null;
		},
	};
}
