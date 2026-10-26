/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Record<string, unknown>;
export interface TrackLockSnapshotIndex {
	readonly tracks: ReadonlyMap<string, DataRecord>;
	locations(trackId: string): readonly unknown[];
	laneMembers(track: DataRecord): readonly unknown[];
	takeGroups(trackId: string): readonly unknown[];
}
const EMPTY = Object.freeze([]);
function record(value: unknown): value is DataRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function optionalId(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}
function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const values = map.get(key);
	if (values) values.push(value); else map.set(key, [value]);
}

/** Called only after inert-tree admission. Noncanonical structures keep lazy legacy validation. */
export function createTrackLockSnapshotIndex(
	project: DataRecord, tracks: readonly DataRecord[],
	snapshotValue: (value: unknown) => unknown, snapshotRecord: (value: DataRecord) => unknown,
): TrackLockSnapshotIndex | null {
	if (!Array.isArray(project.sequences) || project.sequences.some((sequence: unknown) => !record(sequence)
		|| typeof sequence.id !== 'string' || !Array.isArray(sequence.trackNodes)
		|| sequence.trackNodes.some((node: unknown) => !record(node) || typeof node.id !== 'string'
			|| (node.parentFolderId != null && typeof node.parentFolderId !== 'string')))) return null;
	if (Array.isArray(project.takeGroups) && project.takeGroups.some((group: unknown) => !record(group))) return null;
	const trackById = new Map<string, DataRecord>(), lanes = new Map<string, DataRecord[]>();
	for (const track of tracks) {
		if (!trackById.has(track.id as string)) trackById.set(track.id as string, track);
		const lane = optionalId(track.laneGroupId);
		if (lane !== null) append(lanes, lane, track);
	}
	const locations = new Map<string, unknown[]>();
	for (const sequence of project.sequences as DataRecord[]) {
		const nodes = sequence.trackNodes as DataRecord[], folders = new Map<string, DataRecord>();
		for (const node of nodes) if (node.kind === 'folder') folders.set(node.id as string, node);
		const seenTracks = new Set<string>(), ancestorCache = new Map<string | null, readonly string[]>();
		for (const node of nodes) {
			if (node.kind !== 'track' || seenTracks.has(node.id as string)) continue;
			seenTracks.add(node.id as string);
			const parent = optionalId(node.parentFolderId);
			let ancestors = ancestorCache.get(parent);
			if (!ancestors) {
				const values: string[] = [], visited = new Set<string>();
				let next = parent;
				while (next !== null && !visited.has(next)) {
					visited.add(next); values.push(next); next = optionalId(folders.get(next)?.parentFolderId);
				}
				ancestors = Object.freeze(values.reverse()); ancestorCache.set(parent, ancestors);
			}
			append(locations, node.id as string, Object.freeze({ sequenceId: sequence.id, parentFolderId: parent, ancestors }));
		}
	}
	for (const values of locations.values()) Object.freeze(values);
	const takes = new Map<string, DataRecord[]>();
	if (Array.isArray(project.takeGroups)) for (const group of project.takeGroups as DataRecord[]) {
		if (typeof group.trackId === 'string') append(takes, group.trackId, group);
	}
	const laneSnapshots = new Map<string, readonly unknown[]>(), takeSnapshots = new Map<string, readonly unknown[]>();
	return {
		tracks: trackById,
		locations: trackId => locations.get(trackId) ?? EMPTY,
		laneMembers(track) {
			const id = optionalId(track.laneGroupId);
			if (id === null) return EMPTY;
			let values = laneSnapshots.get(id);
			if (!values) {
				values = Object.freeze((lanes.get(id) ?? []).map(member => Object.freeze({
					id: snapshotValue(member.id), type: snapshotValue(member.type),
				})));
				laneSnapshots.set(id, values);
			}
			return values;
		},
		takeGroups(trackId) {
			let values = takeSnapshots.get(trackId);
			if (!values) { values = Object.freeze((takes.get(trackId) ?? []).map(snapshotRecord)); takeSnapshots.set(trackId, values); }
			return values;
		},
	};
}
