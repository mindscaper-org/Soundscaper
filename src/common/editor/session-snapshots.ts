/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord } from '../foundation/closed-domain-value.ts';

type Data = Record<string, unknown>;
export const SESSION_SNAPSHOT_LIMIT = 64;
export const SESSION_SNAPSHOT_NAME_LIMIT = 160;
const IDENTITY_FIELDS = ['id', 'title', 'createdAt', 'updatedAt', 'revision', 'sources'] as const;

export interface SessionSnapshot {
	readonly id: string;
	readonly name: string;
	readonly createdAt: string;
	readonly sourceIds: readonly string[];
	readonly sourceBindings?: Readonly<Record<string, string>>;
	readonly state: Readonly<Data>;
}

export function sessionSnapshotName(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.trim().length > SESSION_SNAPSHOT_NAME_LIMIT) {
		throw new TypeError('A snapshot name of 1–160 characters is required.');
	}
	return value.trim();
}

/** Metadata owns document state only; the outer project owns the single media inventory. */
export function readSessionSnapshots(project: unknown): readonly SessionSnapshot[] {
	const metadata = record(record(project)?.metadata);
	const value = metadata?.sessionSnapshots;
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > SESSION_SNAPSHOT_LIMIT) {
		throw new RangeError('A project may contain at most 64 session snapshots.');
	}
	const ids = new Set<string>();
	return value.map((entry: unknown) => {
		const snapshot = readClosedDomainRecord(entry, 'session snapshot',
			['id', 'name', 'createdAt', 'sourceIds', 'sourceBindings', 'state'], ['id', 'name', 'createdAt', 'sourceIds', 'state']);
		if (typeof snapshot.id !== 'string' || !snapshot.id || snapshot.id.length > 256 || ids.has(snapshot.id)) {
			throw new TypeError('Every snapshot must have a unique stable ID.');
		}
		ids.add(snapshot.id);
		sessionSnapshotName(snapshot.name);
		if (typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt))) {
			throw new TypeError('A snapshot creation timestamp is required.');
		}
		if (!Array.isArray(snapshot.sourceIds) || snapshot.sourceIds.length > 4094
			|| snapshot.sourceIds.some((id: unknown) => typeof id !== 'string' || !id)
			|| new Set(snapshot.sourceIds).size !== snapshot.sourceIds.length) {
			throw new TypeError('Snapshot source IDs must be a bounded unique list.');
		}
		if (snapshot.sourceBindings !== undefined) {
			const bindings = record(snapshot.sourceBindings);
			const sourceIds = snapshot.sourceIds;
			if (!bindings || Object.entries(bindings).some(([id, logicalId]) => !sourceIds.includes(id)
				|| typeof logicalId !== 'string' || !logicalId)) throw new TypeError('Snapshot source bindings are invalid.');
		}
		const state = record(snapshot.state);
		if (!state || !record(state.metadata) || IDENTITY_FIELDS.some(field => Object.hasOwn(state, field))) {
			throw new TypeError('Snapshot state must share its project identity and media inventory.');
		}
		if (Object.hasOwn(record(state.metadata)!, 'sessionSnapshots')) {
			throw new TypeError('Nested session snapshots are not supported.');
		}
		return snapshot as unknown as SessionSnapshot;
	});
}

/** Reconstruct one independently valid document without recursively embedding alternatives. */
export function snapshotProjectState(projectValue: unknown, snapshot: SessionSnapshot): Data & {
	readonly sources: readonly Data[];
	readonly tracks: readonly Data[];
} {
	const project = record(projectValue);
	if (!project || !Array.isArray(project.sources)) throw new TypeError('A snapshot project is required.');
	const ids = new Set(snapshot.sourceIds);
	const sources = project.sources.filter((source: unknown) => ids.has(String(record(source)?.id))).map((source: Data) => ({
		...source, id: snapshot.sourceBindings?.[String(source.id)] ?? source.id,
	}));
	if (sources.length !== ids.size) throw new ReferenceError('A snapshot references missing source media.');
	if (new Set(sources.map(source => source.id)).size !== sources.length) throw new TypeError('Snapshot logical source IDs must be unique.');
	const identity = Object.fromEntries(IDENTITY_FIELDS.filter(key => key !== 'sources').map(key => [key, project[key]]));
	return { ...snapshot.state, ...identity, sources } as unknown as ReturnType<typeof snapshotProjectState>;
}

export function validateSessionSnapshots(project: unknown, validateProject: (value: unknown) => unknown): void {
	for (const snapshot of readSessionSnapshots(project)) validateProject(snapshotProjectState(project, snapshot));
}

export function captureSessionSnapshot(
	projectValue: unknown,
	request: Readonly<{ id: string; name: string; createdAt: string }>,
	sourceIds: Iterable<string>,
): SessionSnapshot {
	const original = record(projectValue);
	if (!original || !record(original.metadata)) throw new TypeError('Project metadata is required for a snapshot.');
	const project = { ...original, metadata: { ...record(original.metadata)! } } as Data;
	for (const key of IDENTITY_FIELDS) delete project[key];
	const metadata = record(project.metadata);
	delete metadata!.sessionSnapshots;
	const snapshot: SessionSnapshot = {
		id: request.id, name: sessionSnapshotName(request.name), createdAt: request.createdAt,
		sourceIds: [...new Set(sourceIds)], state: structuredClone(project),
	};
	readSessionSnapshots({ metadata: { sessionSnapshots: [snapshot] } });
	return snapshot;
}

/** Translate one snapshot's logical IDs through its shared inventory and an archive import. */
export function sessionSnapshotSourceIdMap(snapshot: SessionSnapshot, sourceIdMap: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
	return new Map(snapshot.sourceIds.map(id => [snapshot.sourceBindings?.[id] ?? id, sourceIdMap.get(id) ?? id]));
}

/** All reference-bearing snapshot documents share the root's immutable source descriptors. */
export function sessionSnapshotProjects(project: unknown): readonly ReturnType<typeof snapshotProjectState>[] {
	return readSessionSnapshots(project).map(snapshot => snapshotProjectState(project, snapshot));
}

function record(value: unknown): Data | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : null;
}
