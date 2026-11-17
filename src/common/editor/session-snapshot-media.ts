/* SPDX-License-Identifier: AGPL-3.0-only */

import { readSessionSnapshots, snapshotProjectState, type SessionSnapshot } from './session-snapshots.ts';

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
	do { alias = `snapshot-source-${String(suffix++)}-${sourceId}`; }
	while (sources.some(candidate => candidate.id === alias));
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
}
