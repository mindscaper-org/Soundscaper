/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../common/media/indexeddb.ts';

export type TracktionLocalProject = Readonly<{ id: string; name: string; updated: number }>;

export interface TracktionProjectMetadata {
	readonly generation: number;
	readonly name: string;
	readonly updated: number;
}

export const tracktionProjectStores = ['projects', 'generations'] as const;
const [, generationStore] = tracktionProjectStores;

export async function openTracktionProjectDatabase(): Promise<IDBDatabase> {
	const open = indexedDB.open('soundscaper-tracktion-wasm', 1);
	open.onupgradeneeded = () => {
		for (const store of tracktionProjectStores) open.result.createObjectStore(store, {});
	};
	return await request(open);
}

export function decodeTracktionProjectMetadata(record: unknown): TracktionProjectMetadata | undefined {
	if (typeof record === 'number' && Number.isSafeInteger(record) && record > 0) {
		return { generation: record, name: 'Untitled project', updated: 0 };
	}
	if (!record || typeof record !== 'object') return undefined;
	const { generation, name, updated } = record as Partial<TracktionProjectMetadata>;
	if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation <= 0) return undefined;
	if (typeof name !== 'string' || typeof updated !== 'number' || !Number.isFinite(updated)) return undefined;
	return { generation, name, updated };
}

export async function listTracktionProjects(): Promise<readonly TracktionLocalProject[]> {
	const database = await openTracktionProjectDatabase();
	try {
		const entries = await transact(database, generationStore, 'readonly', async (stores) => {
			const versions = stores[generationStore];
			const [ids, values] = await Promise.all([request(versions.getAllKeys()), request(versions.getAll())]);
			return ids.flatMap((id, index) => {
				const metadata = decodeTracktionProjectMetadata(values[index]);
				return typeof id === 'string' && metadata ? [{ id, name: metadata.name, updated: metadata.updated }] : [];
			});
		});
		return entries.sort((a, b) => b.updated - a.updated);
	} finally {
		database.close();
	}
}
