/* SPDX-License-Identifier: AGPL-3.0-only */

import { defaultMixerChannelMapV21, normalizeMixerGraphV21, type MixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import type { DawprojectImportRoutingContext } from '../common/editor/dawproject-import-structure.ts';
import type { AudioEditorProjectV17 } from '../common/editor/project-v17.ts';
import { applySoundscaperMixerSurfaceCommand } from './editor-project-mixer-surface.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';

/** Promote validated flat interchange buses and routes through the owning graph adapter. */
export function importSoundscaperAudacityMixer(decoded: AudioEditorProjectV17, project: SoundscaperProject, context?: DawprojectImportRoutingContext): MixerGraphV21 {
	let mixer = project.mixer;
	for (const [kind, buses] of [['group', decoded.mixer.groups], ['send', decoded.mixer.sends]] as const) {
		for (const bus of buses) {
			const changes: Record<string, unknown> = {};
			for (const field of ['name', 'color', 'gain', 'pan', 'mute', 'solo', 'collapsed', 'effectsActive']) {
				if (Object.hasOwn(bus, field)) changes[field] = bus[field as keyof typeof bus];
			}
			const existing = (kind === 'group' ? mixer.groups : mixer.sends).some(value => value.id === bus.id);
			mixer = applySoundscaperMixerSurfaceCommand({ ...project, mixer }, existing
				? { type: 'mixer/bus-update', busType: kind, busId: bus.id, changes }
				: { type: 'mixer/bus-add', busType: kind, bus: { id: bus.id, ...changes } });
			const channelCount = context?.stripChannelCounts?.find(strip => strip.id === bus.id)?.channelCount;
			if (channelCount !== undefined) {
				const collection = kind === 'group' ? 'groups' : 'sends';
				mixer = normalizeMixerGraphV21({ ...mixer,
					[collection]: mixer[collection].map(strip => strip.id === bus.id ? { ...strip, channelCount } : strip),
					edges: mixer.edges.map(edge => edge.source.kind === 'mixer-node' && edge.source.id === bus.id
						&& edge.destination.kind === 'master'
						? { ...edge, channelMap: defaultMixerChannelMapV21(channelCount, project.masterChannels) } : edge),
				});
			}
		}
	}
	const folderIds = new Set(project.trackFolders.map(folder => folder.id));
	const parentByTrack = new Map(project.sequences.flatMap(sequence => sequence.trackNodes
		.filter(node => node.kind === 'track').map(node => [node.id, node.parentFolderId] as const)));
	for (const [trackId, route] of Object.entries(decoded.mixer.routes)) {
		// The legacy graph collapses folder buses to the top level. The native
		// graph already owns the complete immediate-parent assignment chain.
		const groupId = route.groupId !== null && folderIds.has(route.groupId)
			? parentByTrack.get(trackId) ?? route.groupId : route.groupId;
		mixer = applySoundscaperMixerSurfaceCommand({ ...project, mixer }, {
			type: 'mixer/route-update', trackId, changes: { groupId, sends: route.sends },
		});
	}
	for (const route of context?.nodeRoutes ?? []) {
		const source = [...mixer.groups, ...mixer.sends].find(bus => bus.id === route.busId);
		if (!source) continue;
		const destination = route.groupId === null ? { kind: 'master' as const }
			: { kind: 'mixer-node' as const, id: route.groupId };
		const width = route.groupId === null ? project.masterChannels
			: mixer.groups.find(bus => bus.id === route.groupId)?.channelCount ?? project.masterChannels;
		mixer = normalizeMixerGraphV21({ ...mixer, edges: [
			...mixer.edges.map(edge => edge.kind === 'assignment' && edge.source.kind === 'mixer-node'
				&& edge.source.id === source.id ? { ...edge, destination,
					channelMap: defaultMixerChannelMapV21(source.channelCount, width) } : edge),
			...route.sends.map((send, index) => ({
				id: `imported-bus-send:${source.id}:${String(index)}`, kind: 'send' as const,
				source: { kind: 'mixer-node' as const, id: source.id },
				destination: { kind: 'mixer-node' as const, id: send.sendId },
				position: send.position, level: send.level, enabled: true,
				channelMap: defaultMixerChannelMapV21(source.channelCount,
					mixer.sends.find(bus => bus.id === send.sendId)?.channelCount ?? project.masterChannels),
			})),
		] });
	}
	// The legacy staging route is destination-indexed. The import context owns
	// every individual send, including parallel connections with different taps.
	const authoredSends = context?.sendTaps.filter(tap => tap.level !== undefined) ?? [];
	if (authoredSends.length) {
		const owners = new Set(authoredSends.map(tap => tap.trackId));
		const sends = authoredSends.flatMap((tap, index) => {
			const edge = mixer.edges.find(edge => edge.kind === 'send' && edge.source.kind === 'track'
				&& edge.source.id === tap.trackId && edge.destination.kind === 'mixer-node' && edge.destination.id === tap.sendId);
			return edge ? [{ ...edge, id: `imported-track-send:${String(index)}`, level: tap.level!, position: tap.position }] : [];
		});
		return normalizeMixerGraphV21({ ...mixer, edges: [
			...mixer.edges.filter(edge => edge.kind !== 'send' || edge.source.kind !== 'track' || !owners.has(edge.source.id)),
			...sends,
		] });
	}
	if (!context?.sendTaps.length) return mixer;
	return normalizeMixerGraphV21({ ...mixer, edges: mixer.edges.map(edge => {
		if (edge.kind !== 'send' || edge.source.kind !== 'track' || edge.destination.kind !== 'mixer-node') return edge;
		const tap = context.sendTaps.find(({ trackId, sendId }) => (
			edge.source.kind === 'track' && edge.source.id === trackId
			&& edge.destination.kind === 'mixer-node' && edge.destination.id === sendId
		));
		return tap ? { ...edge, position: tap.position } : edge;
	}) });
}
