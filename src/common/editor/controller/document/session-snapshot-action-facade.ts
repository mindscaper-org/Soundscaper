/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SessionSnapshotCommand } from '../../commands/session-snapshot.ts';
import { readSessionSnapshots, sessionSnapshotName } from '../../session-snapshots.ts';
import type { EditorProjectToken } from '../shared/lifecycle.ts';

interface Dependencies {
	getProject(): Readonly<{ id: string; schemaFamily?: unknown }> | null;
	createId(prefix: string): string;
	commit(command: SessionSnapshotCommand): unknown;
	prepare(): PromiseLike<unknown> | unknown;
	save(): PromiseLike<unknown> | unknown;
	assertActive(): void;
	captureGeneration?(): EditorProjectToken;
	assertGeneration?(token: EditorProjectToken): void;
}

/** Snapshot publication uses ordinary document history, write authority and saves. */
export function createSessionSnapshotActionFacade(dependencies: Dependencies) {
	function requireProject() {
		dependencies.assertActive();
		const project = dependencies.getProject();
		if (project?.schemaFamily !== 'soundscaper') throw new RangeError('Session snapshots require a Soundscaper project.');
		return project;
	}
	return Object.freeze({
		list: () => readSessionSnapshots(requireProject()).map(({ id, name, createdAt }) => ({ id, name, createdAt })),
		async create(name: string): Promise<string> {
			const normalized = sessionSnapshotName(name);
			const project = requireProject();
			const generation = dependencies.captureGeneration?.();
			await dependencies.prepare();
			if (generation) dependencies.assertGeneration?.(generation);
			if (requireProject().id !== project.id) throw new DOMException('The active snapshot project changed.', 'AbortError');
			const id = dependencies.createId('snapshot');
			dependencies.commit({ type: 'project/snapshot-create', id, name: normalized, createdAt: new Date().toISOString() });
			await dependencies.save();
			return id;
		},
		restore(id: string): void { requireProject(); dependencies.commit({ type: 'project/snapshot-restore', id }); },
		rename(id: string, name: string): void { requireProject(); dependencies.commit({ type: 'project/snapshot-rename', id, name: sessionSnapshotName(name) }); },
		remove(id: string): void { requireProject(); dependencies.commit({ type: 'project/snapshot-remove', id }); },
	});
}
