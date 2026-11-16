/* SPDX-License-Identifier: AGPL-3.0-only */
import { createDefaultMixerGraphV21, defaultMixerChannelMapV21, normalizeMixerGraphV21, type MixerEdgeV21, type MixerStripV21 } from './mixer-graph-v21.ts';
import type { Build } from './dawproject-import-structure.ts';

/** Both products receive the same graph; the legacy V17 staging document owns no automation. */
export function dawprojectImportedFinishing(build: Build, trackWidths: ReadonlyMap<string, number>) {
	const normalizeStrip = (strip: Build['master']): MixerStripV21 => ({
		id: strip.id, name: strip.name, color: 'auto', gain: strip.gain, pan: strip.pan, mute: strip.mute, solo: strip.solo,
		channelCount: strip.channelCount ?? 2, collapsed: false, effectsActive: true, effects: strip.effects ?? [],
	});
	const groups = build.groups.map(normalizeStrip), sends = build.sends.map(normalizeStrip);
	for (const folder of build.folders) if (!groups.some(bus => bus.id === folder.id)) groups.push(normalizeStrip({ id: String(folder.id), name: String(folder.name), gain: 1, pan: 0, mute: false, solo: false, envelope: [] }));
	const widths = new Map([...trackWidths, ...[...groups, ...sends].map(bus => [bus.id, bus.channelCount] as const)]);
	const base = createDefaultMixerGraphV21(build.tracks.map(track => ({ id: track.id, channelCount: widths.get(track.id) ?? 2 })), build.masterChannels);
	const edges: MixerEdgeV21[] = [...base.edges.filter(edge => edge.source.kind === 'master')];
	const map = (id: string, target: string | null) => defaultMixerChannelMapV21(widths.get(id) ?? 2, target ? widths.get(target) ?? 2 : build.masterChannels);
	for (const track of build.tracks) {
		const route = build.routes.get(track.id), parent = build.parentFolderIds.get(track.id);
		const target = route?.groupId && build.folders.some(folder => folder.id === route.groupId) ? parent ?? route.groupId : route?.groupId ?? parent ?? null;
		edges.push({ id: `imported-assignment:${track.id}`, kind: 'assignment', source: { kind: 'track', id: track.id },
			destination: target ? { kind: 'mixer-node', id: target } : { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: map(track.id, target) });
	}
	for (const [index, tap] of build.sendTaps.entries()) edges.push({
		id: `imported-track-send:${index}`, kind: 'send', source: { kind: 'track', id: tap.trackId }, destination: { kind: 'mixer-node', id: tap.sendId },
		level: tap.level ?? 1, position: tap.position, enabled: true, channelMap: map(tap.trackId, tap.sendId),
	});
	for (const bus of [...groups, ...sends]) {
		const route = build.nodeRoutes.find(route => route.busId === bus.id), target = route?.groupId ?? build.parentFolderIds.get(bus.id) ?? null;
		edges.push({ id: `imported-assignment:${bus.id}`, kind: 'assignment', source: { kind: 'mixer-node', id: bus.id },
			destination: target ? { kind: 'mixer-node', id: target } : { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: map(bus.id, target) });
		for (const [index, send] of (route?.sends ?? []).entries()) edges.push({
			id: `imported-bus-send:${bus.id}:${index}`, kind: 'send', source: { kind: 'mixer-node', id: bus.id }, destination: { kind: 'mixer-node', id: send.sendId },
			level: send.level, position: send.position, enabled: true, channelMap: map(bus.id, send.sendId),
		});
	}
	return { mixer: normalizeMixerGraphV21({ ...base, groups, sends, edges }), automationLanes: build.automationLanes };
}
