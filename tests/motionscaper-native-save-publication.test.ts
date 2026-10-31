/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { createMotionSavedFileAuthority } from '../desktop/motion-saved-file-authority.ts';
import { receiveMotionSavedFileSnapshot } from '../src/common/editor/motion-saved-file-source.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { writeMotionscaperDesktopProject } from '../src/motionscaper/editor-document-desktop.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const settings = { title: 'Previously saved', width: 16, height: 16, frameRate: { num: 30, den: 1 }, durationFrames: 2 };
test('a rejected local native Save cannot publish its prepared archive to an independent selected-file watcher', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-native-publication-')), path = join(directory, 'selected.mscape');
	const database = createInstrumentedIndexedDB();
	const store = createMotionscaperProjectStore({ indexedDB: database as unknown as IDBFactory });
	const session = new MotionscaperDocumentSession(store);
	const authority = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => path });
	const watcher = createMotionSavedFileAuthority({ chooseFile: async () => path });
	let fail = false;
	const quota = new DOMException('Injected prepared project publication failure', 'QuotaExceededError');
	const files = { ...authority, commit: async (request: Parameters<typeof authority.commit>[0]) => {
		const receipt = await authority.commit(request);
		if (fail && (request.phase === undefined || request.phase === 'prepare')) {
			fail = false; database.failNextPutForStore('projects', quota);
		}
		return receipt;
	} };
	try {
		await session.create(settings);
		await session.save((project, current) => writeMotionscaperDesktopProject(project, store, files, false, current));
		const original = session.getSnapshot(), originalBytes = await readFile(path);
		const selected = await watcher.select(); assert.ok(selected);
		const first = await watcher.poll({ watchId: selected.watchId, afterGeneration: 0 }); assert.equal(first.state, 'snapshot');
		if (first.state !== 'snapshot') throw new Error('Expected the original saved archive.');
		let accepted: string | undefined;
		await receiveMotionSavedFileSnapshot(watcher, first.snapshot, { receive: async offer => { accepted = offer.revision.digest; } });
		assert.equal(accepted, original.savedDigest);
		await session.changeSettings({ ...settings, title: 'Rejected candidate' });
		const draft = session.getSnapshot(); fail = true;
		await assert.rejects(session.save((project, current) => writeMotionscaperDesktopProject(project, store, files, false, current)), /Injected prepared project publication failure/u);
		const next = await watcher.poll({ watchId: selected.watchId, afterGeneration: first.snapshot.generation });
		if (next.state === 'snapshot') await receiveMotionSavedFileSnapshot(watcher, next.snapshot, { receive: async offer => { accepted = offer.revision.digest; } });
		assert.equal(accepted, original.savedDigest, 'a failed Save must leave the accepted linked revision unchanged');
		assert.deepEqual(await readFile(path), originalBytes, 'prepublication failure restores the prior complete archive');
		assert.equal((await store.load(original.project!.id))?.digest, original.savedDigest);
		assert.equal((await store.loadRecovery(original.project!.id))?.title, 'Rejected candidate');
		assert.equal(session.getSnapshot().savedDigest, original.savedDigest);
		assert.equal(session.getSnapshot().dirty, true);
		assert.equal(session.getSnapshot().canUndo, draft.canUndo);
		await session.undo(); assert.equal(session.getSnapshot().project?.title, settings.title);
		await session.redo(); assert.equal(session.getSnapshot().project?.title, 'Rejected candidate');
	} finally {
		await watcher.dispose(); await authority.dispose(); await session.dispose(); await store.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test('a committed native Save retains explicit local reconciliation and retries without another file publication or history loss', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-native-reconcile-')), path = join(directory, 'selected.mscape');
	const database = createInstrumentedIndexedDB(), store = createMotionscaperProjectStore({ indexedDB: database as unknown as IDBFactory });
	const session = new MotionscaperDocumentSession(store);
	const authority = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => path });
	let fail = false, publications = 0;
	const files = { ...authority, commit: async (request: Parameters<typeof authority.commit>[0]) => {
		const result = await authority.commit(request);
		if (request.phase === 'publish') { publications++; if (fail) { fail = false; database.failNextPutForStore('projects', new Error('local finalize failed')); } }
		return result;
	} };
	try {
		await session.create(settings); await session.save((project, current) => writeMotionscaperDesktopProject(project, store, files, false, current));
		await session.changeSettings({ ...settings, title: 'Published candidate' }); const before = session.getSnapshot();
		fail = true;
		await assert.rejects(session.save((project, current) => writeMotionscaperDesktopProject(project, store, files, false, current)), /file was published/u);
		assert.equal(session.getSnapshot().nativeSavePending, true); assert.equal(session.getSnapshot().dirty, true);
		assert.equal(session.getSnapshot().savedDigest, before.savedDigest);
		assert.equal((await store.load(before.project!.id))?.digest, before.savedDigest);
		await assert.rejects(session.undo(), /resolve|Retry Save/u);
		const count = publications, bytes = await readFile(path);
		await session.save(); assert.equal(publications, count); assert.deepEqual(await readFile(path), bytes);
		assert.equal(session.getSnapshot().nativeSavePending, false); assert.equal(session.getSnapshot().dirty, false);
		assert.equal((await store.load(before.project!.id))?.project.title, 'Published candidate');
		await session.undo(); assert.equal(session.getSnapshot().project?.title, settings.title);
	} finally { await session.dispose(); await store.close(); await authority.dispose(); await rm(directory, { recursive: true, force: true }); }
});
