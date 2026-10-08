/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from './indexeddb-backend.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import { cloneStorageValue } from './storage-clone.ts';

export interface ProjectRecoverySummary {
	readonly id: string;
	readonly title: string;
	readonly revision: number | null;
}

export interface ProjectRecoveryCandidate {
	readonly key: string;
	readonly kind: 'current' | 'revision';
	readonly revision: number | null;
	readonly project: unknown;
	readonly diagnostic?: string;
}

/** Read-only salvage access. Never compact, normalize, validate, or write the damaged rows. */
export class ProjectRecoveryRepository {
	readonly #port: StorageRepositoryPort;
	constructor(port: StorageRepositoryPort) { this.#port = port; }

	async list(): Promise<readonly ProjectRecoverySummary[]> {
		const database = await this.#port.database();
		const snapshot = database
			? await transact(database, ['projects', 'revisions'], 'readonly', async ({ projects, revisions }) => ({
				projects: await request(projects!.getAll()) as unknown[],
				keys: await request(projects!.getAllKeys()),
				revisions: await request(revisions!.getAll()) as unknown[],
			}))
			: { projects: [...this.#port.memory.projects.values()], keys: [...this.#port.memory.projects.keys()],
				revisions: [...this.#port.memory.revisions.values()] };
		const summaries = new Map<string, ProjectRecoverySummary>();
		for (const [index, row] of snapshot.projects.entries()) {
			const value = record(row);
			const id = snapshot.keys[index];
			if (typeof id !== 'string' || !id.trim()) continue;
			summaries.set(id, { id, title: title(value?.title), revision: revision(value?.revision) });
		}
		for (const row of snapshot.revisions) {
			const value = record(row);
			const id = value?.projectId;
			if (typeof id !== 'string' || !id.trim() || summaries.has(id)) continue;
			summaries.set(id, { id, title: title(record(value?.project)?.title), revision: revision(value?.revision) });
		}
		return [...summaries.values()];
	}

	async read(projectId: string): Promise<readonly ProjectRecoveryCandidate[]> {
		if (typeof projectId !== 'string' || !projectId.trim()) throw new TypeError('A recovery project ID is required.');
		const database = await this.#port.database();
		const snapshot = database
			? await transact(database, ['projects', 'revisions'], 'readonly', async ({ projects, revisions }) => ({
				current: await request(projects!.get(projectId)) as unknown,
				revisions: await request(revisions!.index('projectId').getAll(projectId)) as unknown[],
			}))
			: { current: this.#port.memory.projects!.get(projectId), revisions: [...this.#port.memory.revisions.values()]
				.filter((row) => record(row)?.projectId === projectId) };
		const candidates: ProjectRecoveryCandidate[] = [];
		if (snapshot.current !== undefined) candidates.push({
			key: 'current', kind: 'current', revision: revision(record(snapshot.current)?.revision),
			project: cloneStorageValue(snapshot.current),
		});
		for (const [index, row] of snapshot.revisions.entries()) {
			const value = record(row);
			candidates.push({ key: typeof value?.key === 'string' ? value.key : `revision-row-${String(index)}`,
				kind: 'revision', revision: revision(value?.revision), project: cloneStorageValue(value?.project) });
		}
		return candidates.sort((left, right) => (right.revision ?? -1) - (left.revision ?? -1)
			|| Number(right.kind === 'current') - Number(left.kind === 'current'));
	}
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function title(value: unknown): string { return typeof value === 'string' && value.trim() ? value : 'Damaged project'; }
function revision(value: unknown): number | null { return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null; }
