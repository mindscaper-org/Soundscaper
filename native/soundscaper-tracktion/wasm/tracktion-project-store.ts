/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../../src/common/media/indexeddb.ts';
import {
	decodeTracktionProjectMetadata, openTracktionProjectDatabase, tracktionProjectStores, type TracktionProjectMetadata,
} from '../../../src/soundscaper/tracktion-web-project-library.ts';

export interface TracktionVirtualFilesystem {
	findObject(path: string): { isFolder: boolean } | null;
	mkdirTree(path: string): void;
	readFile(path: string): Uint8Array;
	writeFile(path: string, data: Uint8Array): void;
	readdir(path: string): string[];
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

const [projectStore, generationStore] = tracktionProjectStores;
const mediaName = /^[0-9a-f]{32}\.wav$/;
const editName = 'project.tracktionedit';

export async function restoreTracktionProject(
	fs: TracktionVirtualFilesystem, project: WorkingProject,
): Promise<WorkingProject> {
	const database = await openTracktionProjectDatabase();
	let saved: SavedProject | undefined;
	let metadata: unknown;
	try {
		[saved, metadata] = await transact(database, tracktionProjectStores, 'readonly', async (stores) => await Promise.all([
			request(stores[projectStore].get(project.id)) as Promise<SavedProject | undefined>,
			request(stores[generationStore].get(project.id)) as Promise<unknown>,
		]));
	} finally {
		database.close();
	}
	const description = decodeTracktionProjectMetadata(metadata);
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
	const database = await openTracktionProjectDatabase();
	try {
		await transact(database, tracktionProjectStores, 'readwrite', async (stores) => {
			const versions = stores[generationStore];
			const previous = decodeTracktionProjectMetadata(await request(versions.get(project.id)));
			if ((previous?.generation ?? 0) !== project.generation) {
				throw new Error('Another browser tab saved a newer revision of this Tracktion project');
			}
			await Promise.all([
				request(stores[projectStore].put(snapshot, project.id)),
				request(versions.put({ generation, name: project.name, updated: Date.now() } satisfies TracktionProjectMetadata, project.id)),
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
			if (fs.findObject(child)?.isFolder) discard(child);
			else fs.unlink(child);
		}
		fs.rmdir(path);
	}
	const path = `/projects/${project.directory}`;
	if (fs.findObject(path)) discard(path);
}
