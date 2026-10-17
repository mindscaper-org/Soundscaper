/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueAudiocomProjectAudio, saveAudiocomEditorProject } from '../src/common/editor/controller/import/audiocom-project-actions.ts';
import { audiocomProjectArchives, createAudiocomProjectArchives, type AudiocomProjectArchive } from '../src/common/editor/controller/import/audiocom-project-archives.ts';
import { createAudiocomPanelSession } from '../src/common/editor/controller/import/audiocom-panel-session.ts';
import type { SaveAup4Options } from '../src/common/editor/controller/document/native-project-types.ts';

test('save project serializes the open project and automatically advances its own cloud head', async () => {
	let project = { id: 'local-one', title: 'Session' };
	let head: AudiocomProjectArchive = { id: 'cloud-one', name: 'Session', snapshotId: 'head-one', format: 'aup4', size: 32 };
	const targets: (AudiocomProjectArchive | undefined)[] = [];
	const archives = createAudiocomProjectArchives({ client: {
		capabilities: async () => ({ formats: ['aup3', 'aup4'], maximumBytes: 100000000 }),
		list: async () => ({ results: [head], page: 1, hasNext: false }),
		upload: async (_file, _name, _signal, revision) => {
			targets.push(revision); head = { ...head, snapshotId: `head-${targets.length + 1}` }; return head;
		}, download: async () => new Blob(),
	} });
	const serialized: string[] = [];
	const controller = { getSnapshot: () => ({ project }), actions: { project: {
		saveAup4: async (options: SaveAup4Options) => {
			serialized.push(project.id);
			await options.saveFile!({ purpose: 'project', suggestedName: `${project.title}.aup4`, mimeType: 'application/octet-stream',
				blob: new Blob(['SQLite format 3\0current edits']), signal: new AbortController().signal });
		},
	} } };
	await archives.setConnected(true);
	await saveAudiocomEditorProject(controller, archives);
	const first = head;
	await saveAudiocomEditorProject(controller, archives);
	assert.deepEqual(targets, [undefined, first]);
	project = { id: 'local-two', title: 'Session' };
	await saveAudiocomEditorProject(controller, archives);
	assert.equal(targets[2], undefined, 'same titles must not overwrite a different local project');
	assert.deepEqual(serialized, ['local-one', 'local-one', 'local-two']);
	archives.dispose();
});

test('an account change during project serialization fences the upload', async () => {
	let finish!: (file: File) => void;
	let uploads = 0;
	const archives = createAudiocomProjectArchives({ client: {
		capabilities: async () => ({ formats: ['aup3'], maximumBytes: 100000000 }),
		list: async () => ({ results: [], page: 1, hasNext: false }),
		upload: async () => { uploads++; throw new Error('Unexpected upload'); }, download: async () => new Blob(),
	} });
	await archives.setConnected(true);
	const pending = archives.saveProject('one', () => new Promise(resolve => { finish = resolve; }));
	await archives.setConnected(false);
	finish(new File(['SQLite format 3\0current edits'], 'Session.aup3'));
	await pending; assert.equal(uploads, 0); archives.dispose();
});

test('saved project bindings survive reopening and are verified against the signed-in account', async () => {
	let stored = '';
	const revisionStorage = { getItem: () => stored || null, setItem: (_key: string, value: string) => { stored = value; } };
	const item: AudiocomProjectArchive = { id: 'cloud-one', name: 'Session', snapshotId: 'head-one', format: 'aup3', size: 32 };
	const targets: (AudiocomProjectArchive | undefined)[] = [];
	let owned = true;
	const options = { revisionStorage, client: {
		capabilities: async () => ({ formats: ['aup3'] as const, maximumBytes: 100000000 }),
		list: async () => ({ results: owned ? [item] : [], page: 1, hasNext: false }),
		upload: async (_file: File, _name: string, _signal?: AbortSignal, revision?: AudiocomProjectArchive) => { targets.push(revision); return item; },
		download: async () => new Blob(),
	} };
	const file = async () => new File(['SQLite format 3\0current edits'], 'Session.aup3');
	const first = createAudiocomProjectArchives(options);
	await first.setConnected(true); await first.saveProject('local-one', file); first.dispose();
	const reopened = createAudiocomProjectArchives(options);
	await reopened.setConnected(true); await reopened.saveProject('local-one', file);
	assert.deepEqual(targets, [undefined, item]);
	await reopened.setConnected(false); owned = false;
	await reopened.setConnected(true); await reopened.saveProject('local-one', file);
	assert.equal(targets[2], undefined, 'a different account must never revise the previous account’s project');
	reopened.dispose();
});

test('a successful upload retains its new head even if refreshing the list fails', async () => {
	let head: AudiocomProjectArchive = { id: 'cloud', name: 'Session', snapshotId: 'head-one', format: 'aup3', size: 32 };
	const targets: (AudiocomProjectArchive | undefined)[] = [];
	let failList = true;
	const archives = createAudiocomProjectArchives({ client: {
		capabilities: async () => ({ formats: ['aup3'], maximumBytes: 100000000 }),
		list: async () => { if (failList) throw new Error('List unavailable'); return { results: [head], page: 1, hasNext: false }; },
		upload: async (_file, _name, _signal, revision) => {
			targets.push(revision); head = { ...head, snapshotId: `head-${targets.length + 1}` }; return head;
		}, download: async () => new Blob(),
	} });
	const file = async () => new File(['SQLite format 3\0current edits'], 'Session.aup3');
	await archives.setConnected(true); await archives.saveProject('local', file);
	assert.equal(archives.getSnapshot().status, 'error');
	const completed = head;
	failList = false; await archives.saveProject('local', file);
	assert.deepEqual(targets, [undefined, completed]); archives.dispose();
});

test('owner archive sessions retain revision identity on remount and stop when the server changes', async () => {
	const listeners = new Set<() => void>();
	let origin = 'https://api.audio.com';
	let disposed = false;
	const owner = { getSnapshot: () => ({ disposed, preferences: { advanced: { audioComServerUrl: origin } } }),
		subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
	const options = { client: {
		capabilities: async () => ({ formats: ['aup3'] as const, maximumBytes: 100000000 }),
		list: async () => ({ results: [], page: 1, hasNext: false }),
		upload: async (): Promise<never> => { throw new Error('Unexpected upload'); }, download: async () => new Blob(),
	} };
	const first = audiocomProjectArchives(owner, options);
	assert.equal(audiocomProjectArchives(owner, options), first);
	await first.setConnected(true);
	let finish!: (file: File) => void;
	let signal: AbortSignal | undefined;
	const saving = first.saveProject('local', (_format, selected) => { signal = selected; return new Promise(resolve => { finish = resolve; }); });
	origin = 'https://audiocity.example';
	for (const listener of listeners) listener();
	assert.equal(signal?.aborted, true); assert.equal(listeners.size, 0);
	finish(new File(['SQLite format 3\0current edits'], 'Session.aup3')); await saving;
	const next = audiocomProjectArchives(owner, { ...options, apiOrigin: origin });
	assert.notEqual(next, first);
	disposed = true; for (const listener of listeners) listener();
	assert.equal(listeners.size, 0);
});

test('upload audio renders the current mix into the existing publication queue without saving a local file', async () => {
	const session = createAudiocomPanelSession({ client: {
		session: async () => ({ connected: true }), disconnect: async () => {},
		startOAuth: async () => { throw new Error('Unexpected authorization'); }, pollOAuth: async () => null,
		reserveAuthorization: () => ({ open() {}, close() {} }), search: async () => ({ results: [], page: 1, hasNext: false }),
		upload: async () => { throw new Error('Publication requires consent'); },
	} });
	await session.initialize();
	const settings: Record<string, unknown>[] = [];
	const controller = { getSnapshot: () => ({ project: { id: 'one', title: 'Current mix' } }), actions: { export: {
		start: async (request: Record<string, unknown>) => {
			settings.push(request);
			const deliver = request.saveToFile as (value: Record<string, unknown>) => unknown;
			return deliver({ blob: new Blob(['RIFF-current-mix'], { type: 'audio/wav' }), suggestedName: 'Current mix.wav' });
		},
	} } };
	const id = await enqueueAudiocomProjectAudio(controller, session);
	assert.equal(settings[0]?.format, 'wav');
	assert.equal(session.getSnapshot().uploadQueue.items[0]?.id, id);
	assert.equal(session.getSnapshot().uploadQueue.items[0]?.fileName, 'Current mix.wav');
	assert.equal(session.getSnapshot().uploadQueue.items[0]?.status, 'draft'); session.dispose();
});
