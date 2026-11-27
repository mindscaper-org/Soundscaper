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

interface InlineSavedProject {
	readonly edit: Uint8Array;
	readonly media: readonly Readonly<{ name: string; bytes: Uint8Array }>[];
}

interface SavedProjectManifest {
	readonly edit: Uint8Array;
	readonly mediaNames: readonly string[];
}

type SavedProject = InlineSavedProject | SavedProjectManifest;

export interface WorkingProject {
	readonly id: string;
	readonly directory: string;
	readonly generation: number;
	readonly name: string;
	readonly savedMedia: readonly string[];
}

const [projectStore, generationStore] = tracktionProjectStores;
const mediaName = /^[0-9a-f]{32}\.wav$/;
const editName = 'project.tracktionedit';

// Project IDs and WAV names cannot contain a slash, so these keys share the
// existing object store with the project manifests without overlapping them.
const mediaRecord = (projectId: string, name: string) => `${projectId}/${name}`;

export async function restoreTracktionProject(
	fs: TracktionVirtualFilesystem, project: WorkingProject,
): Promise<WorkingProject> {
	const database = await openTracktionProjectDatabase();
	try {
		return await transact(database, tracktionProjectStores, 'readonly', async (stores) => {
			const projects = stores[projectStore];
			const [saved, metadata] = await Promise.all([
				request(projects.get(project.id)) as Promise<SavedProject | undefined>,
				request(stores[generationStore].get(project.id)) as Promise<unknown>,
			]);
			const description = decodeTracktionProjectMetadata(metadata);
			if (!saved || !description) throw new Error('The browser Tracktion project has no saved version');
			const path = `/projects/${project.directory}`;
			fs.mkdirTree(`${path}/media`);
			let savedMedia: readonly string[] = [];
			if ('mediaNames' in saved) {
				for (const name of saved.mediaNames) {
					if (!mediaName.test(name)) throw new Error('The saved Tracktion media name is invalid');
					const bytes: unknown = await request(projects.get(mediaRecord(project.id, name)));
					if (!(bytes instanceof Uint8Array)) throw new Error('The saved Tracktion media is unavailable');
					fs.writeFile(`${path}/media/${name}`, bytes);
				}
				savedMedia = saved.mediaNames;
			} else {
				for (const file of saved.media) {
					if (!mediaName.test(file.name)) throw new Error('The saved Tracktion media name is invalid');
					fs.writeFile(`${path}/media/${file.name}`, file.bytes);
				}
			}
			fs.writeFile(`${path}/${editName}`, saved.edit);
			return { ...project, generation: description.generation, name: description.name, savedMedia };
		});
	} finally {
		database.close();
	}
}

export async function publishTracktionProject(
	fs: TracktionVirtualFilesystem, project: WorkingProject,
): Promise<WorkingProject> {
	const path = `/projects/${project.directory}`;
	const mediaNames = fs.readdir(`${path}/media`).filter((name) => mediaName.test(name));
	const retained = new Set(mediaNames);
	const published = new Set(project.savedMedia);
	const generation = project.generation + 1;
	const database = await openTracktionProjectDatabase();
	try {
		await transact(database, tracktionProjectStores, 'readwrite', async (stores) => {
			const versions = stores[generationStore];
			const previous = decodeTracktionProjectMetadata(await request(versions.get(project.id)));
			if ((previous?.generation ?? 0) !== project.generation) {
				throw new Error('Another browser tab saved a newer revision of this Tracktion project');
			}
			const projects = stores[projectStore];
			// Committed WAVs are immutable. Only new files need to cross the
			// Wasm boundary and be cloned into IndexedDB during Save.
			for (const name of mediaNames) {
				if (published.has(name)) continue;
				await request(projects.put(fs.readFile(`${path}/media/${name}`), mediaRecord(project.id, name)));
			}
			for (const name of published) {
				if (!retained.has(name)) await request(projects.delete(mediaRecord(project.id, name)));
			}
			const snapshot = { edit: fs.readFile(`${path}/${editName}`), mediaNames } satisfies SavedProjectManifest;
			await Promise.all([
				request(projects.put(snapshot, project.id)),
				request(versions.put({ generation, name: project.name, updated: Date.now() } satisfies TracktionProjectMetadata, project.id)),
			]);
		});
	} finally {
		database.close();
	}
	return { ...project, generation, savedMedia: mediaNames };
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
