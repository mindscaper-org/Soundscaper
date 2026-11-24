/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../../src/common/media/indexeddb.ts';

export interface TracktionVirtualFilesystem {
	analyzePath(path: string): { exists: boolean };
	mkdirTree(path: string): void;
	readFile(path: string): Uint8Array;
	writeFile(path: string, data: Uint8Array): void;
	readdir(path: string): string[];
	stat(path: string): { mode: number };
	isDir(mode: number): boolean;
	unlink(path: string): void;
	rmdir(path: string): void;
}

interface SavedProject {
	readonly edit: Uint8Array;
	readonly media: readonly Readonly<{ name: string; bytes: Uint8Array }>[];
}

export interface WorkingProject {
	readonly id: string;
	readonly directory: string;
	readonly generation: number;
	readonly name: string;
}

interface ProjectMetadata {
	readonly generation: number;
	readonly name: string;
	readonly updated: number;
}

const projectStore = 'projects';
const generationStore = 'generations';
const storeNames = [projectStore, generationStore] as const;
const mediaName = /^[0-9a-f]{32}\.wav$/;
const editName = 'project.tracktionedit';

async function projectDatabase(): Promise<IDBDatabase> {
	const open = indexedDB.open('soundscaper-tracktion-wasm', 1);
	open.onupgradeneeded = () => {
		for (const store of storeNames) open.result.createObjectStore(store);
	};
	return await request(open);
}

function decodeMetadata(record: unknown): ProjectMetadata | undefined {
	if (typeof record === 'number' && Number.isSafeInteger(record) && record > 0) {
		return { generation: record, name: 'Untitled project', updated: 0 };
	}
	if (!record || typeof record !== 'object') return undefined;
	const { generation, name, updated } = record as Partial<ProjectMetadata>;
	if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation <= 0) return undefined;
	if (typeof name !== 'string' || typeof updated !== 'number' || !Number.isFinite(updated)) return undefined;
	return { generation, name, updated };
}

export async function listTracktionProjects(): Promise<readonly Readonly<{ id: string; name: string }>[]> {
	const database = await projectDatabase();
	try {
		const entries = await transact(database, generationStore, 'readonly', async (stores) => {
			const versions = stores[generationStore];
			const [ids, values] = await Promise.all([request(versions.getAllKeys()), request(versions.getAll())]);
			return ids.flatMap((id, index) => {
				const metadata = decodeMetadata(values[index]);
				return typeof id === 'string' && metadata ? [{ id, name: metadata.name, updated: metadata.updated }] : [];
			});
		});
		return entries.sort((a, b) => b.updated - a.updated).map(({ id, name }) => ({ id, name }));
	} finally {
		database.close();
	}
}

export async function restoreTracktionProject(
	fs: TracktionVirtualFilesystem, project: WorkingProject,
): Promise<WorkingProject> {
	const database = await projectDatabase();
	let saved: SavedProject | undefined;
	let metadata: unknown;
	try {
		[saved, metadata] = await transact(database, storeNames, 'readonly', async (stores) => await Promise.all([
			request(stores[projectStore].get(project.id)) as Promise<SavedProject | undefined>,
			request(stores[generationStore].get(project.id)) as Promise<unknown>,
		]));
	} finally {
		database.close();
	}
	const description = decodeMetadata(metadata);
	if (!saved || !description) throw new Error('The browser Tracktion project has no saved version');
	const path = `/projects/${project.directory}`;
	fs.mkdirTree(`${path}/media`);
	for (const file of saved.media) {
		if (!mediaName.test(file.name)) throw new Error('The saved Tracktion media name is invalid');
		fs.writeFile(`${path}/media/${file.name}`, file.bytes);
	}
	fs.writeFile(`${path}/${editName}`, saved.edit);
	return { ...project, generation: description.generation, name: description.name };
}

export async function publishTracktionProject(
	fs: TracktionVirtualFilesystem, project: WorkingProject,
): Promise<WorkingProject> {
	const path = `/projects/${project.directory}`;
	const snapshot: SavedProject = {
		edit: fs.readFile(`${path}/${editName}`),
		media: fs.readdir(`${path}/media`).filter((name) => mediaName.test(name)).map((name) => ({
			name, bytes: fs.readFile(`${path}/media/${name}`),
		})),
	};
	const generation = project.generation + 1;
	const database = await projectDatabase();
	try {
		await transact(database, storeNames, 'readwrite', async (stores) => {
			const versions = stores[generationStore];
			const previous = decodeMetadata(await request(versions.get(project.id)));
			if ((previous?.generation ?? 0) !== project.generation) {
				throw new Error('Another browser tab saved a newer revision of this Tracktion project');
			}
			await Promise.all([
				request(stores[projectStore].put(snapshot, project.id)),
				request(versions.put({ generation, name: project.name, updated: Date.now() } satisfies ProjectMetadata, project.id)),
			]);
		});
	} finally {
		database.close();
	}
	return { ...project, generation };
}

export function discardWorkingProject(fs: TracktionVirtualFilesystem, project: WorkingProject): void {
	function discard(path: string): void {
		for (const name of fs.readdir(path)) {
			if (name === '.' || name === '..') continue;
			const child = `${path}/${name}`;
			if (fs.isDir(fs.stat(child).mode)) discard(child);
			else fs.unlink(child);
		}
		fs.rmdir(path);
	}
	const path = `/projects/${project.directory}`;
	if (fs.analyzePath(path).exists) discard(path);
}
