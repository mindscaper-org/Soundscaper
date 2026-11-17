/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, type createDeliveryReport } from './delivery-report.ts';
import { parameterToPan } from './dawproject-format.ts';
import type { DawprojectChannel, DawprojectDocument, DawprojectTrack } from './dawproject-import.ts';
import type { MixerGraphV21 } from './mixer-graph-v21.ts';
import type { AutomationLaneV21 } from './automation-lane-v21.ts';
import type { ParameterAddress } from './parameter-address.ts';
import { dawprojectStaticGain } from './dawproject-import-gain.ts';
import { readDawprojectMidiTrackComment } from './dawproject-midi-metadata.ts';
import { withMidiTrackData } from './midi-model.ts';
import { dawprojectImportColor } from './dawproject-colors.ts';

/**
 * The structural half of the DAWproject importer: tracks, folders, buses,
 * routing, and channel automation, accumulated into one build the assembler
 * turns into a document.
 *
 * A DAWproject `Track` is one of several things here. One declaring tracks or
 * holding children is a folder, including an empty folder. A top-level folder
 * with a channel owns a group bus that shares its id — the folder-bus identity
 * rule of this project. A leaf channel's role decides the rest: master,
 * submix, effect, or an audio track.
 * Membership matters for routing: a folder bus takes only its own tracks, so a
 * track routed into a group it is not inside routes to the master and the
 * report says so, rather than the route silently vanishing on document load.
 */

export type Draft = ReturnType<typeof createDeliveryReport>;
export type DataRecord = Record<string, unknown>;

export interface EnvelopePoint {
	frame: number;
	value: number;
}

export interface TrackBuild {
	readonly opaqueExtensions?: Readonly<Record<string, unknown>>;
	readonly id: string;
	readonly name: string;
	readonly color?: string;
	effects?: readonly Readonly<Record<string, unknown>>[];
	gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly clipIds: string[];
	envelope: EnvelopePoint[];
}

export interface StripBuild {
	readonly id: string;
	readonly name: string;
	readonly channelCount?: number;
	effects?: readonly Readonly<Record<string, unknown>>[];
	gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	envelope: EnvelopePoint[];
}

export interface ParameterTarget {
	readonly kind: 'track' | 'master' | 'group' | 'send';
	readonly id: string | null;
	readonly parameter: 'volume' | 'pan' | 'mute' | 'effect';
	readonly address?: ParameterAddress;
	readonly inactive?: boolean;
	readonly convert?: (value: number) => number;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly unit: string | null;
}

export interface DawprojectImportNodeRoute {
	readonly busId: string;
	readonly groupId: string | null;
	readonly sends: readonly Readonly<{ sendId: string; level: number; position: 'pre-fader' | 'post-fader' }>[];
}

/** Per-import graph semantics that the shared numeric-send document cannot carry. */
export interface DawprojectImportRoutingContext {
	readonly mixerGraph?: MixerGraphV21;
	readonly automationLanes?: readonly AutomationLaneV21[];
	readonly sendTaps: readonly Readonly<{ trackId: string; sendId: string; level?: number; position: 'pre-fader' | 'post-fader' }>[];
	readonly nodeRoutes?: readonly DawprojectImportNodeRoute[];
	readonly stripChannelCounts?: readonly Readonly<{ id: string; channelCount: number }>[];
}

export interface Build {
	readonly draft: Draft;
	readonly automationLanes: AutomationLaneV21[];
	readonly sampleRate: number;
	readonly createStableId: (prefix: string) => string;
	readonly tracks: TrackBuild[];
	readonly trackByDawId: Map<string, TrackBuild>;
	readonly folderByDawId: Map<string, string>;
	readonly trackNodes: DataRecord[];
	readonly folders: DataRecord[];
	readonly groups: StripBuild[];
	readonly sends: StripBuild[];
	readonly busByChannelId: Map<string, string>;
	readonly nodeRoutes: DawprojectImportNodeRoute[];
	readonly stripByChannelId: Map<string, Readonly<{ kind: 'group' | 'send' | 'folder'; id: string }>>;
	readonly parameters: Map<string, ParameterTarget>;
	readonly routes: Map<string, { groupId: string | null; sends: Record<string, number> }>;
	readonly sendTaps: { trackId: string; sendId: string; level?: number; position: 'pre-fader' | 'post-fader' }[];
	/** Parent folder per built track and per folder, for bus membership. */
	readonly parentFolderIds: Map<string, string | null>;
	master: StripBuild;
	masterChannels: number;
	omittedTracks: number;
	omittedNodes: number;
	devices: number;
}


export function walkTrack(track: DawprojectTrack, parentFolderId: string | null, build: Build, document: DawprojectDocument): void {
	const channel = track.channel;
	const role = channel?.role ?? 'regular';
	build.devices += channel?.devices ?? 0;
	if (track.contentTypes.includes('tracks') || track.children.length > 0) {
		const id = build.createStableId('folder');
		const name = track.name.trim() ? track.name : 'Folder';
		if (track.id) build.folderByDawId.set(track.id, id);
		build.folders.push({ id, name, mute: importedMute(track.loaded === false, channel?.mute?.value, build, { kind: 'folder', id }), solo: channel?.solo === true });
		build.trackNodes.push({ kind: 'folder', id, parentFolderId });
		build.parentFolderIds.set(id, parentFolderId);
		if (channel) {
			// Only a top-level folder owns a bus here; a nested group's channel
			// merges into its top-level ancestor's bus, which the report says.
			if (parentFolderId === null) {
				// Structural gates belong to the folder; its owned bus cannot
				// duplicate them as independent mixer mute or solo state.
				build.groups.push({ ...strip(id, name, channel, build), mute: false, solo: false });
				if (channel.id) build.busByChannelId.set(channel.id, id);
				registerParameters(channel, { kind: 'group', id, inactive: track.loaded === false }, build);
			} else {
				addDeliveryReportItem(build.draft, {
					code: 'dawproject.nested-bus-converted', disposition: 'converted', severity: 'warning',
					scope: { kind: 'folder', id }, data: { name: track.name },
					message: 'A group inside a group has no bus of its own here; its tracks feed the top-level folder\'s bus and its fader is not imported.',
				});
			}
			if (channel.id) build.stripByChannelId.set(channel.id, { kind: 'folder', id: topLevelFolder(id, build) });
		}
		for (const child of track.children) walkTrack(child, id, build, document);
		return;
	}
	if (role === 'master') {
		build.master = strip('master', 'Master', channel!, build, track.loaded === false);
		build.masterChannels = channel!.audioChannels ?? 2;
		registerParameters(channel!, { kind: 'master', id: null, inactive: track.loaded === false }, build);
		return;
	}
	if (role === 'submix' || role === 'effect') {
		const id = build.createStableId(role === 'submix' ? 'group-bus' : 'send-bus');
		(role === 'submix' ? build.groups : build.sends).push(strip(id, track.name || (role === 'submix' ? 'Group' : 'Send'), channel!, build, track.loaded === false));
		if (channel!.id) {
			build.stripByChannelId.set(channel!.id, { kind: role === 'submix' ? 'group' : 'send', id });
			build.busByChannelId.set(channel!.id, id);
		}
		registerParameters(channel!, { kind: role === 'submix' ? 'group' : 'send', id, inactive: track.loaded === false }, build);
		return;
	}
	if (role === 'vca') {
		build.omittedNodes += 1;
		return;
	}
	if (track.contentTypes.length > 0 && !track.contentTypes.includes('audio') && !track.contentTypes.includes('notes')) {
		build.omittedTracks += 1;
		addDeliveryReportItem(build.draft, {
			code: 'dawproject.track-content-omitted', disposition: 'omitted', severity: 'warning',
			scope: { kind: 'track', id: track.id ?? track.name },
			data: { name: track.name, contentTypes: track.contentTypes },
			message: 'The track holds no audio or notes; automation and video tracks have no audio track to become.',
		});
		return;
	}
	const built = createAudioTrack(track.name, channel, build, track.color, track.loaded === false);
	const midi = readDawprojectMidiTrackComment(track.comment);
	if (midi || track.contentTypes.includes('notes')) Object.assign(built,
		withMidiTrackData({ ...built, type: 'audio' }, midi ?? { version: 1, instrument: 'triangle' }));
	if (track.id) build.trackByDawId.set(track.id, built);
	if (channel) registerParameters(channel, { kind: 'track', id: built.id, inactive: track.loaded === false }, build);
	build.trackNodes.push({ kind: 'track', id: built.id, parentFolderId });
	build.parentFolderIds.set(built.id, parentFolderId);
}

function topLevelFolder(folderId: string, build: Build): string {
	let current = folderId;
	for (;;) {
		const parent = build.parentFolderIds.get(current) ?? null;
		if (parent === null) return current;
		current = parent;
	}
}

function isInsideFolder(trackId: string, folderId: string, build: Build): boolean {
	let current = build.parentFolderIds.get(trackId) ?? null;
	while (current !== null) {
		if (current === folderId) return true;
		current = build.parentFolderIds.get(current) ?? null;
	}
	return false;
}

function createAudioTrack(name: string, channel: DawprojectChannel | null, build: Build, rgb?: string | null, inactive = false): TrackBuild {
	const id = build.createStableId('track');
	const color = dawprojectImportColor(rgb, build.draft, { kind: 'track', id });
	const built: TrackBuild = {
		id,
		name: name.trim() ? name : `Track ${String(build.tracks.length + 1)}`,
		...(color ? { color } : {}),
		gain: dawprojectStaticGain(channel?.volume, build.draft, { kind: 'track', id }),
		pan: panOf(channel?.pan),
		mute: importedMute(inactive, channel?.mute?.value, build, { kind: 'track', id }),
		solo: channel?.solo === true,
		clipIds: [],
		envelope: [],
	};
	build.tracks.push(built);
	return built;
}

function strip(id: string, name: string, channel: DawprojectChannel, build: Build, inactive = false): StripBuild {
	return {
		id, name, gain: dawprojectStaticGain(channel.volume, build.draft, { kind: id === 'master' ? 'master' : 'mixer-node', id }), pan: panOf(channel.pan),
		channelCount: channel.audioChannels ?? 2,
		mute: importedMute(inactive, channel.mute?.value, build, { kind: id === 'master' ? 'master' : 'mixer-node', id }), solo: channel.solo, envelope: [],
	};
}

function importedMute(inactive: boolean, mute: boolean | null | undefined, build: Build, scope: DataRecord): boolean {
	if (inactive) addDeliveryReportItem(build.draft, {
		code: 'dawproject.inactive-track-converted', disposition: 'converted', severity: 'warning', scope,
		data: { loaded: false, mute: true },
		message: 'Inactive tracks were imported muted; their audio remains available for reactivation.',
	});
	return inactive || mute === true;
}

function registerParameters(channel: DawprojectChannel, target: Readonly<{ kind: ParameterTarget['kind']; id: string | null; inactive?: boolean }>, build: Build): void {
	if (channel.volume?.id) build.parameters.set(channel.volume.id, { ...target, parameter: 'volume', unit: channel.volume.unit });
	if (channel.pan?.id) build.parameters.set(channel.pan.id, { ...target, parameter: 'pan', unit: channel.pan.unit });
	if (channel.mute?.id) build.parameters.set(channel.mute.id, { ...target, parameter: 'mute', unit: null });
}

export function resolveRouting(document: DawprojectDocument, build: Build): void {
	const visit = (track: DawprojectTrack): void => {
		for (const child of track.children) visit(child);
		const built = track.id ? build.trackByDawId.get(track.id) : undefined;
		const channel = track.channel;
		if (channel) resolveBusRouting(channel, build);
		if (!built || !channel) return;
		const route = { groupId: null as string | null, sends: {} as Record<string, number> };
		const destination = channel.destination ? build.stripByChannelId.get(channel.destination) : undefined;
		if (destination?.kind === 'group') route.groupId = destination.id;
		else if (destination?.kind === 'folder') {
			// A folder's bus is fed by its members and nothing else; a track that
			// routes into a group it is not inside has no route to keep.
			if (isInsideFolder(built.id, destination.id, build)) route.groupId = destination.id;
			else {
				addDeliveryReportItem(build.draft, {
					code: 'dawproject.routing-omitted', disposition: 'omitted', severity: 'warning',
					scope: { kind: 'track', id: built.id }, data: { name: track.name },
					message: 'The track feeds a group it is not inside; folder buses here take only their own tracks, so the track routes to the master.',
				});
			}
		}
		for (const send of channel.sends) {
			if (!send.enabled || !send.destination) continue;
			const target = build.stripByChannelId.get(send.destination);
			if (target?.kind !== 'send') continue;
			route.sends[target.id] = dawprojectStaticGain(send.volume, build.draft, { kind: 'track', id: built.id, sendId: target.id });
			if (send.volume?.id) build.parameters.set(send.volume.id, { kind: 'track', id: built.id, parameter: 'volume', unit: send.volume.unit, address: { kind: 'edge', edgeId: `imported-track-send:${String(build.sendTaps.length)}`, parameterId: 'level' } });
			build.sendTaps.push({ trackId: built.id, sendId: target.id, level: route.sends[target.id],
				position: send.type === 'pre' ? 'pre-fader' : 'post-fader' });
		}
		if (route.groupId !== null || Object.keys(route.sends).length > 0) build.routes.set(built.id, route);
	};
	for (const track of document.tracks) visit(track);
}

/** Bus-origin routing is independent of the audio-track map. */
function resolveBusRouting(channel: DawprojectChannel, build: Build): void {
	const busId = channel.id ? build.busByChannelId.get(channel.id) : undefined;
	if (!busId) return;
	const destination = channel.destination ? build.stripByChannelId.get(channel.destination) : undefined;
	if (destination?.kind === 'folder') {
		addDeliveryReportItem(build.draft, {
			code: 'dawproject.routing-omitted', disposition: 'omitted', severity: 'warning',
			scope: { kind: 'mixer-node', id: busId },
			message: 'The bus feeds a folder; folder buses here take only their own tracks, so the bus routes to the master.',
		});
	}
	const sends: DawprojectImportNodeRoute['sends'][number][] = [];
	for (const send of channel.sends) {
		if (!send.enabled || !send.destination) continue;
		const target = build.stripByChannelId.get(send.destination);
		if (target?.kind !== 'send') continue;
		if (send.volume?.id) build.parameters.set(send.volume.id, { kind: 'group', id: busId, parameter: 'volume', unit: send.volume.unit, address: { kind: 'edge', edgeId: `imported-bus-send:${busId}:${String(sends.length)}`, parameterId: 'level' } });
		sends.push({ sendId: target.id, level: dawprojectStaticGain(send.volume, build.draft, { kind: 'mixer-node', id: busId, sendId: target.id }),
			position: send.type === 'pre' ? 'pre-fader' : 'post-fader' });
	}
	build.nodeRoutes.push({ busId, groupId: destination?.kind === 'group' ? destination.id : null,
		sends });
}

export function trackForEvent(event: Readonly<{ trackId: string | null }>, build: Build, document: DawprojectDocument): TrackBuild {
	if (event.trackId) {
		const existing = build.trackByDawId.get(event.trackId);
		if (existing) return existing;
		const declared = findTrack(document.tracks, event.trackId);
		const folderId = build.folderByDawId.get(event.trackId) ?? null;
		// A folder's own audio enters its existing channel alongside child tracks.
		// Its channel state belongs to that bus, never to this synthetic leaf too.
		const built = createAudioTrack(declared?.name ?? event.trackId, folderId ? null : declared?.channel ?? null, build, declared?.color, !folderId && declared?.loaded === false);
		build.trackByDawId.set(event.trackId, built);
		const node = { kind: 'track', id: built.id, parentFolderId: folderId };
		if (folderId) {
			const index = build.trackNodes.findIndex(node => node.id === folderId) + 1;
			const trackIndex = build.trackNodes.slice(0, index).filter(node => node.kind === 'track').length;
			build.trackNodes.splice(index, 0, node);
			build.tracks.pop();
			build.tracks.splice(trackIndex, 0, built);
		} else build.trackNodes.push(node);
		build.parentFolderIds.set(built.id, folderId);
		return built;
	}
	const fallback = build.trackByDawId.get('');
	if (fallback) return fallback;
	const built = createAudioTrack('Imported audio', null, build);
	build.trackByDawId.set('', built);
	build.trackNodes.push({ kind: 'track', id: built.id, parentFolderId: null });
	return built;
}

function findTrack(tracks: readonly DawprojectTrack[], id: string): DawprojectTrack | null {
	for (const track of tracks) {
		if (track.id === id) return track;
		const nested = findTrack(track.children, id);
		if (nested) return nested;
	}
	return null;
}

export function stripRecord(value: StripBuild): DataRecord {
	return { id: value.id, name: value.name, gain: value.gain, pan: value.pan, mute: value.mute, solo: value.solo, envelope: value.envelope, effects: value.effects ?? [] };
}

function panOf(parameter: Readonly<{ value: number | null; unit: string | null }> | null | undefined): number {
	if (!parameter || parameter.value === null) return 0;
	return parameterToPan(parameter.value, parameter.unit) ?? 0;
}
