/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import {
	publishTracktionProject, restoreTracktionProject, type TracktionVirtualFilesystem,
} from '../native/soundscaper-tracktion/wasm/tracktion-project-store.ts';
import { openTracktionProjectDatabase, tracktionProjectStores } from '../src/soundscaper/tracktion-web-project-library.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const [projects, generations] = tracktionProjectStores;
const id = 'a'.repeat(32);
const firstName = `${'1'.repeat(32)}.wav`;
const secondName = `${'2'.repeat(32)}.wav`;
const initialEdit = Uint8Array.of(4, 8, 16);
const initialMedia = Uint8Array.of(7, 14, 21, 28);
const addedMedia = Uint8Array.of(91, 92);
const draft = { id, directory: 'original', generation: 0, name: 'Working Edit', savedMedia: [] };

class ProjectFilesystem implements TracktionVirtualFilesystem {
	readonly files = new Map<string, Uint8Array>();
	readonly reads: string[] = [];
	readonly directories = new Set<string>();

	findObject(path: string) { return this.directories.has(path) ? { isFolder: true } : this.files.has(path) ? { isFolder: false } : null; }
	mkdirTree(path: string): void { this.directories.add(path); }
	readFile(path: string): Uint8Array {
		const bytes = this.files.get(path);
		assert.ok(bytes, `Missing fixture file ${path}`);
		this.reads.push(path);
		return bytes.slice();
	}
	writeFile(path: string, bytes: Uint8Array): void { this.files.set(path, bytes.slice()); }
	readdir(path: string): string[] {
		const prefix = `${path}/`;
		return [...this.files.keys()].filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
	}
	unlink(path: string): void { this.files.delete(path); }
	rmdir(path: string): void { this.directories.delete(path); }
}

async function setup(context: TestContext) {
	const storage = createInstrumentedIndexedDB();
	const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
	Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: storage });
	context.after(() => {
		if (original) Object.defineProperty(globalThis, 'indexedDB', original);
		else Reflect.deleteProperty(globalThis, 'indexedDB');
	});
	const db = await openTracktionProjectDatabase();
	const name = db.name;
	db.close();
	const fs = new ProjectFilesystem();
	fs.writeFile('/projects/original/project.tracktionedit', initialEdit);
	fs.writeFile(`/projects/original/media/${firstName}`, initialMedia);
	return { storage, name, fs };
}

test('saving an edited Tracktion project reuses saved audio and updates only changed media', async (context) => {
	const { fs, storage, name } = await setup(context);
	const first = await publishTracktionProject(fs, draft);
	assert.equal(first.generation, 1);
	fs.reads.length = 0;
	const revisedEdit = Uint8Array.of(32, 64);
	fs.writeFile('/projects/original/project.tracktionedit', revisedEdit);
	const revised = await publishTracktionProject(fs, first);
	assert.deepEqual(fs.reads, ['/projects/original/project.tracktionedit']);
	assert.equal(storage.recordCount(name, projects), 2, 'one Edit manifest and one WAV record');

	fs.unlink(`/projects/original/media/${firstName}`);
	fs.writeFile(`/projects/original/media/${secondName}`, addedMedia);
	const edited = await publishTracktionProject(fs, revised);
	assert.equal(edited.generation, 3);
	assert.equal(storage.recordCount(name, projects), 2, 'replacing a WAV removes its old record');
	const reopened = new ProjectFilesystem();
	await restoreTracktionProject(reopened, { ...draft, directory: 'reopened' });
	assert.deepEqual(reopened.files.get(`/projects/reopened/media/${secondName}`), addedMedia);
	assert.deepEqual(reopened.files.get('/projects/reopened/project.tracktionedit'), revisedEdit);
	assert.equal(reopened.files.has(`/projects/reopened/media/${firstName}`), false);
});

test('legacy inline Tracktion audio reopens and is moved into its own record on the next save', async (context) => {
	const { storage, name } = await setup(context);
	storage.seedRecord(name, projects, { edit: initialEdit, media: [{ name: firstName, bytes: initialMedia }] }, id);
	storage.seedRecord(name, generations, 7, id);
	const reopened = new ProjectFilesystem();
	const restored = await restoreTracktionProject(reopened, { ...draft, directory: 'legacy' });
	assert.equal(restored.generation, 7);
	assert.equal(restored.name, 'Untitled project');
	assert.deepEqual(reopened.files.get(`/projects/legacy/media/${firstName}`), initialMedia);
	await publishTracktionProject(reopened, restored);
	assert.deepEqual(storage.records(name, projects), [
		{ edit: initialEdit, mediaNames: [firstName] }, initialMedia,
	]);
	const saved = new ProjectFilesystem();
	await restoreTracktionProject(saved, { ...draft, directory: 'migrated' });
	assert.deepEqual(saved.files.get(`/projects/migrated/media/${firstName}`), initialMedia);
});

test('a failed or stale Tracktion save keeps the previous Edit and all its audio', async (context) => {
	const { fs, storage, name } = await setup(context);
	const first = await publishTracktionProject(fs, draft);
	const snapshot = storage.records(name, projects);
	fs.unlink(`/projects/original/media/${firstName}`);
	fs.writeFile(`/projects/original/media/${secondName}`, addedMedia);
	fs.reads.length = 0;
	await assert.rejects(publishTracktionProject(fs, draft), /Another browser tab saved/u);
	assert.equal(fs.reads.some((path) => path.endsWith('.wav')), false);
	storage.failNextPutForStore(generations, new Error('The disk is unavailable'));
	await assert.rejects(publishTracktionProject(fs, first), /The disk is unavailable/u);
	assert.deepEqual(storage.records(name, projects), snapshot);
	const restored = new ProjectFilesystem();
	await restoreTracktionProject(restored, { ...draft, directory: 'after-failure' });
	assert.deepEqual(restored.files.get(`/projects/after-failure/media/${firstName}`), initialMedia);
	assert.equal(restored.files.has(`/projects/after-failure/media/${secondName}`), false);
	const retried = await publishTracktionProject(fs, first);
	assert.equal(retried.generation, 2);
});
