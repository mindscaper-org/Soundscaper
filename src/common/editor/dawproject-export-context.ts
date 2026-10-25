/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createDeliveryReport } from './delivery-report.ts';
import { DawprojectIdAllocator, mediaEntryName } from './dawproject-format.ts';
import type { HoldTempoMap } from './timeline-time.ts';
import type { DawprojectRoutingIndex } from './dawproject-export-routing-index.ts';
import { frozenRecordIdIndex, hasOwnDataValue } from './frozen-record-id-index.ts';

/**
 * State the two halves of the DAWproject writer share.
 *
 * `dawproject-export.ts` writes the Structure (tracks, channels, routing) and
 * `dawproject-export-lanes.ts` writes the Arrangement (clips, automation,
 * markers). Both address the same tracks, channels, and parameters, so the id
 * allocator, media registry, and report draft live here rather than in either.
 */

export type DataRecord = Readonly<Record<string, unknown>>;
export type DeliveryReportDraft = ReturnType<typeof createDeliveryReport>;

export interface DawprojectMediaEntry {
	readonly path: string;
	readonly sourceId: string;
	readonly kind: 'audio' | 'video';
}

export interface DawprojectStructureNode {
	readonly kind: 'folder' | 'track';
	readonly id: string;
	readonly folder: DataRecord | null;
	readonly track: DataRecord | null;
	readonly children: readonly DawprojectStructureNode[];
}

export interface DawprojectMixerStrip {
	readonly id: string;
	readonly name: string;
	readonly channelCount: number | null;
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly envelope: readonly DataRecord[];
	readonly effects: readonly unknown[];
}

export interface DawprojectTrackRoute {
	readonly groupId: string | null;
	readonly sends: readonly Readonly<{ id: string; level: number; position: 'pre' | 'post' }>[];
	readonly disconnected?: boolean;
	readonly mainOutput?: boolean;
}

export interface DawprojectMixerRouting {
	readonly groups: readonly DawprojectMixerStrip[];
	readonly sends: readonly DawprojectMixerStrip[];
	readonly routes: ReadonlyMap<string, DawprojectTrackRoute>;
	readonly nodeRoutes: ReadonlyMap<string, DawprojectTrackRoute>;
	/** Node kinds the profile has no channel role for, for the report. */
	readonly omittedNodes: number;
	readonly masterDisconnected?: boolean;
}

export interface DawprojectExportContext {
	readonly project: DataRecord;
	readonly sampleRate: number;
	readonly ids: DawprojectIdAllocator;
	readonly draft: DeliveryReportDraft;
	readonly sourceById: ReadonlyMap<string, DataRecord>;
	readonly clipById: ReadonlyMap<string, DataRecord>;
	readonly media: DawprojectMediaRegistry;
	readonly routing: DawprojectMixerRouting;
	readonly routingLookup?: DawprojectRoutingIndex<DawprojectMixerStrip>;
	readonly separateOutputMaster: boolean;
	readonly readAudioTrackChannels?: (track: DataRecord, fallback: number) => number;
	readonly readStripAutomationLanes?: (key: string) => ReadonlyMap<string, DataRecord>;
	readonly readAdditionalFolderBusIds?: () => ReadonlySet<string>;
	readonly embeddableVideoSourceIds: ReadonlySet<string>;
	readonly tempoMap: HoldTempoMap | null;
	/** V21 lane ids the arrangement wrote, so the rest can be reported as omitted. */
	readonly consumedLaneIds: Set<string>;
}

/** One embedded file per source, however many clips play it. */
export class DawprojectMediaRegistry {
	readonly #entries = new Map<string, DawprojectMediaEntry>();

	register(source: DataRecord, kind: 'audio' | 'video'): DawprojectMediaEntry {
		const sourceId = String(source.id);
		const existing = this.#entries.get(sourceId);
		if (existing) return existing;
		const extension = kind === 'audio' ? '.wav' : videoExtension(source);
		const entry: DawprojectMediaEntry = Object.freeze({
			path: mediaEntryName(kind, this.#entries.size, String(source.name ?? sourceId), extension),
			sourceId,
			kind,
		});
		this.#entries.set(sourceId, entry);
		return entry;
	}

	entries(): readonly DawprojectMediaEntry[] {
		return Object.freeze([...this.#entries.values()]);
	}
}

/** The stable allocator key for a strip, shared by structure, automation, and routing. */
export function stripKey(strip: DataRecord | null | undefined): string | null {
	if (!strip) return null;
	if (strip.kind === 'master') return 'master';
	if ((strip.kind === 'track' || strip.kind === 'mixer-node') && typeof strip.id === 'string') {
		return `${strip.kind}:${strip.id}`;
	}
	return null;
}

export function channelIdFor(context: DawprojectExportContext, key: string): string {
	return context.ids.id('channel', key);
}

export function parameterIdFor(context: DawprojectExportContext, key: string, parameter: 'volume' | 'pan' | 'mute'): string {
	return context.ids.id('parameter', key, parameter);
}

/**
 * The track hierarchy as the sequence states it, in document order.
 *
 * `trackNodes` is a DFS preorder with parent pointers; folders become nested
 * Track elements so the receiving DAW sees the same grouping. Tracks the
 * sequence does not list (a document that predates hierarchy, or a fixture)
 * fall back to flat project order rather than vanishing.
 */
export function dawprojectStructureTree(project: DataRecord, sequenceId?: string): readonly DawprojectStructureNode[] {
	const tracks = records(project.tracks);
	const trackById = new Map(tracks.map((track) => [String(track.id), track]));
	const folders = new Map(records(project.trackFolders).map((folder) => [String(folder.id), folder]));
	const sequences = records(project.sequences);
	const sequence = dawprojectExportSequence(project, sequenceId);
	const assignedElsewhere = new Set(sequences.filter((candidate) => candidate !== sequence)
		.flatMap((candidate) => records(candidate.trackNodes).filter((node) => node.kind === 'track').map((node) => String(node.id))));
	const nodes = records(sequence?.trackNodes);
	const roots: DawprojectStructureNode[] = [];
	const childrenByFolder = new Map<string, DawprojectStructureNode[]>();
	const seenTracks = new Set<string>();
	for (const node of nodes) {
		const id = String(node.id);
		const parentId = node.parentFolderId == null ? null : String(node.parentFolderId);
		const siblings = parentId === null ? roots : (childrenByFolder.get(parentId) ?? roots);
		if (node.kind === 'folder') {
			const children: DawprojectStructureNode[] = [];
			childrenByFolder.set(id, children);
			siblings.push({ kind: 'folder', id, folder: folders.get(id) ?? { id, name: id }, track: null, children });
			continue;
		}
		const track = trackById.get(id);
		if (!track || seenTracks.has(id)) continue;
		seenTracks.add(id);
		siblings.push({ kind: 'track', id, folder: null, track, children: [] });
	}
	for (const track of tracks) {
		const id = String(track.id);
		if (seenTracks.has(id) || assignedElsewhere.has(id)) continue;
		seenTracks.add(id);
		roots.push({ kind: 'track', id, folder: null, track, children: [] });
	}
	return freezeTree(roots);
}

export function dawprojectExportSequence(project: DataRecord, sequenceId?: string): DataRecord | null {
	const sequences = records(project.sequences);
	return sequences.find((candidate) => String(candidate.id) === String(sequenceId ?? project.primarySequenceId ?? ''))
		?? sequences[0] ?? null;
}

export function dawprojectStructureTracks(nodes: readonly DawprojectStructureNode[]): readonly DataRecord[] {
	return nodes.flatMap((node) => node.kind === 'track' && node.track ? [node.track] : dawprojectStructureTracks(node.children));
}

/** Referenced buses outside the delivered hierarchy remain channels, without their foreign audio tracks. */
export function dawprojectAdditionalFolderBusIds(context: Pick<DawprojectExportContext, 'project' | 'routing'>, structure: readonly DawprojectStructureNode[]): ReadonlySet<string> {
	const folderIds = new Set(records(context.project.trackFolders).map(folder => String(folder.id)));
	const nodes = [...structure];
	const deliveredFolders = new Set<string>();
	const trackIds: string[] = [];
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index]!;
		if (node.kind === 'folder') deliveredFolders.add(node.id);
		else trackIds.push(node.id);
		for (const child of node.children) nodes.push(child);
	}
	const retained = new Set([...deliveredFolders, ...context.routing.sends.map(strip => strip.id),
		...context.routing.groups.filter(strip => !folderIds.has(strip.id)).map(strip => strip.id)]);
	const pending = [...retained];
	const follow = (route: DawprojectTrackRoute | undefined): void => {
		for (const id of [route?.groupId, ...(route?.sends.map(send => send.id) ?? [])]) {
			if (id && !retained.has(id)) { retained.add(id); pending.push(id); }
		}
	};
	for (const id of trackIds) follow(context.routing.routes.get(id));
	for (let index = 0; index < pending.length; index++) follow(context.routing.nodeRoutes.get(pending[index]!));
	return new Set([...retained].filter(id => folderIds.has(id) && !deliveredFolders.has(id)));
}

/** Reuse graph reachability only while the private export's immutable folder owner remains current. */
export function createDawprojectFolderBusReader(
	context: Pick<DawprojectExportContext, 'project' | 'routing'>,
	structure: readonly DawprojectStructureNode[],
): () => ReadonlySet<string> {
	const owner: unknown = Object.getOwnPropertyDescriptor(context.project, 'trackFolders')?.value;
	const stable = Array.isArray(owner) && Object.isFrozen(owner) && Object.keys(owner).length === owner.length
		&& frozenRecordIdIndex(owner as readonly (DataRecord & { readonly id: string })[]) !== null;
	let cached: ReadonlySet<string> | undefined;
	return () => {
		if (!stable || !hasOwnDataValue(context.project, 'trackFolders', owner)) return dawprojectAdditionalFolderBusIds(context, structure);
		return cached ??= dawprojectAdditionalFolderBusIds(context, structure);
	};
}

/** Split the Master only for a main-output route whose owner is actually delivered. */
export function dawprojectHasMainOutputBypass(context: Pick<DawprojectExportContext, 'project' | 'routing' | 'readAdditionalFolderBusIds'>, structure: readonly DawprojectStructureNode[]): boolean {
	if (dawprojectStructureTracks(structure).some(track => context.routing.routes.get(String(track.id))?.mainOutput)) return true;
	const folderIds = new Set(records(context.project.trackFolders).map(folder => String(folder.id)));
	const delivered = new Set(context.readAdditionalFolderBusIds?.() ?? dawprojectAdditionalFolderBusIds(context, structure));
	const pending = [...structure];
	for (let index = 0; index < pending.length; index++) {
		const node = pending[index]!;
		if (node.kind === 'folder') delivered.add(node.id);
		for (const child of node.children) pending.push(child);
	}
	return [...context.routing.groups, ...context.routing.sends].some(strip => (!folderIds.has(strip.id) || delivered.has(strip.id))
		&& context.routing.nodeRoutes.get(strip.id)?.mainOutput === true);
}

function freezeTree(nodes: DawprojectStructureNode[]): readonly DawprojectStructureNode[] {
	return Object.freeze(nodes.map((node) => Object.freeze({
		...node,
		children: freezeTree([...node.children]),
	})));
}

/**
 * Read the project's mixer routing in the compact shape current documents
 * persist (`groups`, `sends`, `routes`), or a V21 graph when one is present.
 * Folder-owned group buses carry their folder's id, which is how the structure
 * writer knows a folder Track owns a Channel.
 */
export function readDawprojectMixerRouting(project: DataRecord): DawprojectMixerRouting {
	const mixer = record(project.mixer);
	if (mixer.schemaVersion === 1 && Array.isArray(mixer.edges)) return readGraphRouting(mixer);
	const routes = new Map<string, DawprojectTrackRoute>();
	for (const [trackId, value] of Object.entries(record(mixer.routes))) {
		const route = record(value);
		const sends: DawprojectTrackRoute['sends'][number][] = [];
		for (const [sendId, level] of Object.entries(record(route.sends))) {
			if (Number.isFinite(Number(level))) sends.push({ id: sendId, level: Number(level), position: 'post' });
		}
		routes.set(trackId, Object.freeze({ groupId: route.groupId == null ? null : String(route.groupId), sends }));
	}
	return Object.freeze({
		groups: records(mixer.groups).map(strip),
		sends: records(mixer.sends).map(strip),
		routes,
		nodeRoutes: new Map(),
		omittedNodes: 0,
	});
}

function readGraphRouting(graph: DataRecord): DawprojectMixerRouting {
	const routes = new Map<string, { groupId: string | null; sends: DawprojectTrackRoute['sends'][number][]; mainOutput?: boolean; disconnected?: boolean }>();
	const nodeRoutes: typeof routes = new Map();
	const assignments = new Set<string>();
	const mainOutput = records(graph.outputs).find(output => output.role === 'main')?.id;
	const masterRoutes = records(graph.edges).filter(edge => edge.enabled !== false && edge.kind !== 'sidechain'
		&& record(edge.source).kind === 'master');
	const masterDisconnected = mainOutput !== undefined && masterRoutes.every(edge =>
		record(edge.destination).kind === 'output' && record(edge.destination).id !== mainOutput);
	const route = (entries: typeof routes, sourceId: string) => {
		let entry = entries.get(sourceId);
		if (!entry) {
			entry = { groupId: null, sends: [] };
			entries.set(sourceId, entry);
		}
		return entry;
	};
	for (const edge of records(graph.edges)) {
		if (edge.enabled === false) continue;
		const source = record(edge.source);
		const destination = record(edge.destination);
		if (edge.kind === 'assignment' && (source.kind === 'track' || source.kind === 'mixer-node')) {
			assignments.add(JSON.stringify([source.kind, source.id]));
		}
		if (source.kind !== 'track' && source.kind !== 'mixer-node') continue;
		const entries = source.kind === 'track' ? routes : nodeRoutes;
		if (edge.kind === 'assignment' && destination.kind === 'output') {
			const entry = route(entries, String(source.id));
			entry.mainOutput = destination.id === mainOutput;
			entry.disconnected = !entry.mainOutput;
			continue;
		}
		if (destination.kind !== 'mixer-node') continue;
		if (edge.kind === 'assignment') route(entries, String(source.id)).groupId = String(destination.id);
		else if (edge.kind === 'send') route(entries, String(source.id)).sends.push({ id: String(destination.id),
			level: Number(edge.level ?? 1), position: edge.position === 'pre-fader' ? 'pre' : 'post',
		});
	}
	return Object.freeze({
		groups: records(graph.groups).map(strip),
		sends: records(graph.sends).map(strip),
		routes: exportRoutes(routes, 'track'),
		nodeRoutes: exportRoutes(nodeRoutes, 'mixer-node'),
		omittedNodes: records(graph.cues).length + records(graph.vcas).length,
		...(masterDisconnected ? { masterDisconnected: true } : {}),
	});

	function exportRoutes(entries: typeof routes, kind: string): ReadonlyMap<string, DawprojectTrackRoute> {
		return new Map([...entries].map(([id, entry]) => [id, Object.freeze({ ...entry,
			disconnected: entry.disconnected === true || entry.sends.length > 0 && !assignments.has(JSON.stringify([kind, id])),
		})]));
	}
}

function strip(value: DataRecord): DawprojectMixerStrip {
	return Object.freeze({
		id: String(value.id),
		name: String(value.name ?? value.id),
		channelCount: Number.isSafeInteger(value.channelCount) && Number(value.channelCount) > 0
			? Number(value.channelCount) : null,
		gain: finite(value.gain, 1),
		pan: finite(value.pan, 0),
		mute: value.mute === true,
		solo: value.solo === true,
		envelope: records(value.envelope),
		effects: Array.isArray(value.effects) ? value.effects : [],
	});
}

export function records(value: unknown): readonly DataRecord[] {
	return (Array.isArray(value) ? value : [])
		.filter((entry): entry is DataRecord => Boolean(entry) && typeof entry === 'object');
}

export function record(value: unknown): DataRecord {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : {};
}

export function finite(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function videoExtension(source: DataRecord): string {
	const name = String(source.name ?? '');
	const match = /\.([a-z0-9]{2,5})$/iu.exec(name);
	if (match) return `.${match[1]!.toLowerCase()}`;
	const mimeType = String(source.mimeType ?? '');
	if (mimeType === 'video/webm') return '.webm';
	if (mimeType === 'video/quicktime') return '.mov';
	return '.mp4';
}
