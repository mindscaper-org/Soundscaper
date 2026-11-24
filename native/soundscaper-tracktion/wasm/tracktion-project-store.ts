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

export async function restoreTracktionProject(
	fs: TracktionVirtualFilesystem, project: WorkingProject,
): Promise<WorkingProject> {
	const database = await projectDatabase();
	let saved: SavedProject | undefined;
	let generation: number | undefined;
	try {
		[saved, generation] = await transact(database, storeNames, 'readonly', async (stores) => await Promise.all([
			request(stores[projectStore].get(project.id)) as Promise<SavedProject | undefined>,
			request(stores[generationStore].get(project.id)) as Promise<number | undefined>,
		]));
	} finally {
		database.close();
	}
	if (!saved || generation === undefined) throw new Error('The browser Tracktion project has no saved version');
	const path = `/projects/${project.directory}`;
	fs.mkdirTree(`${path}/media`);
	for (const file of saved.media) {
		if (!mediaName.test(file.name)) throw new Error('The saved Tracktion media name is invalid');
		fs.writeFile(`${path}/media/${file.name}`, file.bytes);
	}
	fs.writeFile(`${path}/${editName}`, saved.edit);
	return { ...project, generation };
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
			const previous = await request(versions.get(project.id)) as number | undefined;
			if ((previous ?? 0) !== project.generation) {
				throw new Error('Another browser tab saved a newer revision of this Tracktion project');
			}
			await Promise.all([
				request(stores[projectStore].put(snapshot, project.id)),
				request(versions.put(generation, project.id)),
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
