/* SPDX-License-Identifier: AGPL-3.0-only */

import { readSessionSnapshots, snapshotProjectState, type SessionSnapshot } from './session-snapshots.ts';
import { digestBytes } from '../media/bytes.ts';

export function sessionSnapshotUsesSource(project: unknown, sourceId: string): boolean {
	return readSessionSnapshots(project).some(snapshot => snapshot.sourceIds.includes(sourceId));
}

/** Preserve old source facts by aliasing their existing bytes before a destructive rewrite. */
export function preserveSessionSnapshotSource(project: Record<string, unknown>, sourceId: string): void {
	const snapshots = readSessionSnapshots(project).filter(snapshot => snapshot.sourceIds.includes(sourceId));
	if (snapshots.length === 0) return;
	const sources = project.sources as Record<string, unknown>[];
	const source = sources.find(candidate => candidate.id === sourceId);
	if (!source) throw new ReferenceError('Snapshot media is missing.');
	let suffix = 1;
	let alias: string;
	do {
		const identity = JSON.stringify([sourceId, suffix++]);
		alias = `snapshot-source:${digestBytes(new TextEncoder().encode(identity))}`;
	} while (sources.some(candidate => candidate.id === alias));
	sources.push({ ...source, id: alias, storageKey: source.storageKey || sourceId });
	for (const snapshot of snapshots) {
		const bindings = { ...snapshot.sourceBindings, [alias]: snapshot.sourceBindings?.[sourceId] ?? sourceId };
		delete bindings[sourceId];
		const mutable = snapshot as unknown as Record<string, unknown>;
		mutable.sourceIds = snapshot.sourceIds.map(id => id === sourceId ? alias : id);
		mutable.sourceBindings = bindings;
	}
}

/** Keep alternative source generations while installing the selected editing state. */
export function restoreSessionSnapshotState(project: Record<string, unknown>, snapshot: SessionSnapshot): void {
	const restored: Record<string, unknown> = structuredClone(snapshotProjectState(project, snapshot));
	const savedSources = restored.sources as Record<string, unknown>[];
	for (const source of savedSources) {
		const current = (project.sources as Record<string, unknown>[]).find(candidate => candidate.id === source.id);
		if (current && JSON.stringify(current) !== JSON.stringify(source)) preserveSessionSnapshotSource(project, String(source.id));
	}
	const sourceById = new Map((project.sources as Record<string, unknown>[]).map(source => [source.id, source]));
	for (const source of savedSources) sourceById.set(source.id, source);
	restored.sources = [...sourceById.values()];
	restored.metadata = { ...(restored.metadata as Record<string, unknown>), sessionSnapshots: readSessionSnapshots(project) };
	for (const key of Object.keys(project)) delete project[key];
	Object.assign(project, restored);
	coalesceRestoredMedia(project, savedSources);
}

function coalesceRestoredMedia(project: Record<string, unknown>, activeSources: readonly Record<string, unknown>[]): void {
	const active = new Map(activeSources.map(source => [sourceIdentity(source), String(source.id)]));
	const activeIds = new Set(activeSources.map(source => String(source.id)));
	const snapshots = readSessionSnapshots(project);
	project.sources = (project.sources as Record<string, unknown>[]).filter(source => {
		const id = String(source.id), target = active.get(sourceIdentity(source));
		if (!target || target === id || activeIds.has(id)) return true;
		for (const snapshot of snapshots) {
			if (!snapshot.sourceIds.includes(id)) continue;
			const logicalId = snapshot.sourceBindings?.[id] ?? id;
			if (snapshot.sourceIds.includes(target) && (snapshot.sourceBindings?.[target] ?? target) !== logicalId) continue;
			const bindings = { ...snapshot.sourceBindings, [target]: logicalId };
			delete bindings[id];
			const mutable = snapshot as unknown as Record<string, unknown>;
			mutable.sourceIds = [...new Set(snapshot.sourceIds.map(key => key === id ? target : key))];
			mutable.sourceBindings = bindings;
		}
		return snapshots.some(snapshot => snapshot.sourceIds.includes(id));
	});
}

function sourceIdentity(source: Record<string, unknown>): string {
	const identity: Record<string, unknown> = { ...source, storageKey: source.storageKey || source.id };
	delete identity.id;
	return JSON.stringify(identity);
}
