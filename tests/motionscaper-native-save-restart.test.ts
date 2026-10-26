/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { openMotionscaperDesktopProject, writeMotionscaperDesktopProject } from '../src/motionscaper/editor-document-desktop.ts';
import { exportMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import type { MotionscaperDocumentOpen } from '../src/motionscaper/editor-document-open.ts';
import { openMotionProjectDatabase } from '../src/common/editor/storage/motion-project-database.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { beginMotionscaperDesktopSave } from '../src/motionscaper/desktop-file-adapter.ts';
import { readMotionSaveJournal } from '../desktop/motion-save-publication-journal.ts';
import { createMotionscaperOpaqueArchive } from './helpers/motionscaper-opaque-archive.ts';
import type { MotionscaperOpaqueArchive } from '../src/motionscaper/editor-opaque-archive.ts';

// Teardown removes only this isolated fake database's reservations, even when a regression fails.
async function clearTestReservations(factory: IDBFactory): Promise<void> {
	const database = await openMotionProjectDatabase(factory, 'kw-media-motionscaper-editor-v1');
	try {
		await transact(database, ['projects', 'nativeSaves'], 'readwrite', async stores => {
			const pointers: Record<string, unknown>[] = await request(stores.projects.getAll());
			for (const pointer of pointers) { const { nativeSaveId: _pending, ...prior } = pointer; await request(stores.projects.put(prior)); }
			await request(stores.nativeSaves.clear());
		});
	} finally { database.close(); }
}

test('an interrupted first native Save can reconcile through Save when rollback leaves no archive to reopen', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-first-save-restart-')), path = join(directory, 'first.mscape');
	const factory = createInstrumentedIndexedDB() as unknown as IDBFactory; let now = 1000;
	const original = createMotionscaperProjectStore({ indexedDB: factory, now: () => now });
	const project = createMotionscaperProject({ id: 'first-save', compositionId: 'main', title: 'Recoverable draft' });
	const first = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => path });
	const second = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => path });
	const restarted = createMotionscaperProjectStore({ indexedDB: factory, now: () => now });
	const session = new MotionscaperDocumentSession(restarted);
	try {
		const lease = await original.acquireWriteAccess(project.id); await original.saveRecovery(project, null, lease);
		const output = await writeMotionscaperDesktopProject(project, original, first, false, () => original.assertWriteAccess(lease));
		assert.ok(output && typeof output === 'object' && output.kind === 'motion-native-save');
		await original.prepareNativeSave(project, null, lease, output.receipt); await first.dispose(); now += 16000;
		await session.open(project.id, true); assert.equal(session.getSnapshot().nativeSavePending, true);
		await session.save((snapshot, current) => writeMotionscaperDesktopProject(snapshot, restarted, second, false, current));
		assert.equal(session.getSnapshot().nativeSavePending, false); assert.equal(session.getSnapshot().dirty, true);
		assert.equal(await restarted.loadNativeSave(project.id), null); await assert.rejects(readFile(path), { code: 'ENOENT' });
		await session.save((snapshot, current) => writeMotionscaperDesktopProject(snapshot, restarted, second, false, current));
		assert.equal(session.getSnapshot().dirty, false); assert.equal((await restarted.load(project.id))?.project.title, project.title);
		assert.ok((await readFile(path)).length > 0);
	} finally {
		await clearTestReservations(factory);
		await Promise.allSettled([session.dispose(), first.dispose(), second.dispose()]);
		await Promise.allSettled([original.close(), restarted.close()]); await rm(directory, { recursive: true, force: true });
	}
});

test('reopening a rolled-back Save As reconciles its transaction owner while retaining the different original project', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-save-as-restart-')), path = join(directory, 'original.mscape');
	const factory = createInstrumentedIndexedDB() as unknown as IDBFactory; let now = 1000;
	const original = createMotionscaperProjectStore({ indexedDB: factory, now: () => now });
	const before = createMotionscaperProject({ id: 'file-owner', compositionId: 'a', title: 'Original file' });
	const archive = await exportMotionscaperArchive(before, () => null); assert.ok(archive); const priorBytes = new Uint8Array(await archive.arrayBuffer()); await writeFile(path, priorBytes);
	const project = createMotionscaperProject({ id: 'saving-owner', compositionId: 'b', title: 'Saved elsewhere' });
	const first = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => path });
	let saveDialogs = 0;
	const second = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => { saveDialogs++; return join(directory, 'new.mscape'); } });
	const restarted = createMotionscaperProjectStore({ indexedDB: factory, now: () => now });
	const session = new MotionscaperDocumentSession(restarted); let review: MotionscaperDocumentOpen | undefined;
	try {
		const saved = await original.save(project, null), lease = await original.acquireWriteAccess(project.id);
		const draft = { ...project, revision: 1, title: 'Interrupted overwrite' }; await original.saveRecovery(draft, saved.digest, lease);
		const output = await writeMotionscaperDesktopProject(draft, original, first, false, () => original.assertWriteAccess(lease));
		assert.ok(output && typeof output === 'object' && output.kind === 'motion-native-save');
		await original.prepareNativeSave(draft, saved.digest, lease, output.receipt); await first.dispose(); now += 16000;
		assert.equal(await openMotionscaperDesktopProject(session, second, undefined, pending => { review = pending; }), 'review');
		assert.equal(review?.review.incoming.id, before.id); assert.equal(await restarted.loadNativeSave(project.id), null);
		assert.equal((await restarted.load(project.id))?.digest, saved.digest); assert.equal((await restarted.loadRecovery(project.id))?.title, draft.title);
		await review?.close(); assert.deepEqual(new Uint8Array(await readFile(path)), priorBytes);
		const unbound = await second.beginSave({ projectId: before.id, suggestedName: 'new.mscape', saveAs: false }); assert.ok(unbound);
		assert.equal(saveDialogs, 1, 'Cancel after reconciliation must not bind the reviewed original'); await second.cancel({ token: unbound.token });
	} finally {
		await review?.close().catch(() => undefined); await clearTestReservations(factory);
		await Promise.allSettled([session.dispose(), first.dispose(), second.dispose()]);
		await Promise.allSettled([original.close(), restarted.close()]); await rm(directory, { recursive: true, force: true });
	}
});

test('reopening a published Save finalizes its reserved revision once without republishing archive bytes', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-published-save-restart-')), path = join(directory, 'published.mscape');
	const factory = createInstrumentedIndexedDB() as unknown as IDBFactory; let now = 1000;
	const original = createMotionscaperProjectStore({ indexedDB: factory, now: () => now });
	const restarted = createMotionscaperProjectStore({ indexedDB: factory, now: () => now });
	const project = createMotionscaperProject({ id: 'published-owner', compositionId: 'main', title: 'Before Save' });
	const dialogs = { chooseOpen: async () => path, chooseSave: async () => path };
	const first = createMotionscaperFileAuthority(dialogs), second = createMotionscaperFileAuthority(dialogs);
	const session = new MotionscaperDocumentSession(restarted); let review: MotionscaperDocumentOpen | undefined;
	const events: string[] = []; restarted.subscribeSaved(value => events.push(value.digest));
	try {
		const saved = await original.save(project, null), lease = await original.acquireWriteAccess(project.id);
		const draft = { ...project, revision: 1, title: 'Published before restart' }; await original.saveRecovery(draft, saved.digest, lease);
		const output = await writeMotionscaperDesktopProject(draft, original, first, false, () => original.assertWriteAccess(lease));
		assert.ok(output && typeof output === 'object' && output.kind === 'motion-native-save');
		const prepared = await original.prepareNativeSave(draft, saved.digest, lease, output.receipt);
		await output.publish(); const bytes = await readFile(path); await first.dispose(); now += 16000;
		await session.open(project.id, true); assert.equal(session.getSnapshot().nativeSavePending, true);
		assert.equal(await openMotionscaperDesktopProject(session, second, undefined, pending => { review = pending; }), 'review');
		assert.equal(session.getSnapshot().savedDigest, prepared.snapshot.digest); assert.equal(session.getSnapshot().dirty, false);
		assert.equal(session.getSnapshot().nativeSavePending, false); assert.equal(await restarted.loadNativeSave(project.id), null);
		assert.equal(await restarted.loadRecovery(project.id), null); assert.deepEqual(events, [prepared.snapshot.digest]);
		await review?.open('keep'); assert.deepEqual(await readFile(path), bytes); assert.equal(await readMotionSaveJournal(path), null);
	} finally {
		await review?.close().catch(() => undefined); await clearTestReservations(factory);
		await Promise.allSettled([session.dispose(), first.dispose(), second.dispose()]);
		await Promise.allSettled([original.close(), restarted.close()]); await rm(directory, { recursive: true, force: true });
	}
});

test('Save Copy recovers a published copy without a local reservation and retains retryable ACK cleanup without changing the document', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-published-copy-restart-')), path = join(directory, 'copy.mscape');
	const factory = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const store = createMotionscaperProjectStore({ indexedDB: factory }), session = new MotionscaperDocumentSession(store);
	const dialogs = { chooseOpen: async () => path, chooseSave: async () => path };
	const first = createMotionscaperFileAuthority(dialogs), second = createMotionscaperFileAuthority(dialogs);
	let failAck = true;
	const files = { ...second, async cancel(request: Parameters<typeof second.cancel>[0]) {
		if (request.acknowledge && failAck) { failAck = false; throw new Error('copy ACK interrupted'); }
		await second.cancel(request);
	} };
	try {
		await session.create({ title: 'Saved document', width: 16, height: 16, frameRate: { num: 30, den: 1 }, durationFrames: 2 });
		await session.edit([{ type: 'project/rename', title: 'Current draft' }]); const before = session.getSnapshot(); assert.ok(before.project);
		const copy = await beginMotionscaperDesktopSave(first, { projectId: before.project.id, suggestedName: 'copy.mscape', saveAs: true, saveCopy: true }); assert.ok(copy);
		await exportMotionscaperArchive(before.project, () => null, { writable: copy.writable }); await copy.prepare(); await copy.commit();
		const bytes = await readFile(path); await first.dispose();
		await assert.rejects(session.exportSnapshot(async project => {
			const output = await writeMotionscaperDesktopProject(project, store, files, true);
			assert.ok(output && typeof output === 'object' && output.kind === 'motion-native-save-recovery'); return output;
		}), /cleanup needs retry/u);
		assert.equal(session.getSnapshot().nativeSavePending, true); assert.equal(await store.loadNativeSave(before.project.id), null);
		await session.save(); assert.equal(session.getSnapshot().nativeSavePending, false);
		assert.equal(session.getSnapshot().savedDigest, before.savedDigest); assert.equal(session.getSnapshot().dirty, true);
		assert.equal(session.getSnapshot().canUndo, before.canUndo); assert.equal((await store.load(before.project.id))?.digest, before.savedDigest);
		assert.deepEqual(await readFile(path), bytes); assert.equal(await readMotionSaveJournal(path), null);
		await session.undo(); assert.equal(session.getSnapshot().project?.title, 'Saved document');
	} finally {
		await clearTestReservations(factory); await Promise.allSettled([session.dispose(), first.dispose(), second.dispose()]);
		await store.close(); await rm(directory, { recursive: true, force: true });
	}
});

test('reopening a rolled-back overwrite of a foreign archive reconciles its Motion owner before entering read-only custody', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-foreign-save-restart-')), path = join(directory, 'foreign.mscape');
	const factory = createInstrumentedIndexedDB() as unknown as IDBFactory; let now = 1000;
	const original = createMotionscaperProjectStore({ indexedDB: factory, now: () => now });
	const restarted = createMotionscaperProjectStore({ indexedDB: factory, now: () => now });
	const archive = await createMotionscaperOpaqueArchive('soundscaper', 1), bytes = new Uint8Array(await archive.arrayBuffer()); await writeFile(path, bytes);
	const project = createMotionscaperProject({ id: 'motion-owner', compositionId: 'main', title: 'Motion draft' });
	const dialogs = { chooseOpen: async () => path, chooseSave: async () => path };
	const first = createMotionscaperFileAuthority(dialogs), second = createMotionscaperFileAuthority(dialogs);
	const session = new MotionscaperDocumentSession(restarted); let retained: MotionscaperOpaqueArchive | undefined;
	try {
		const saved = await original.save(project, null), lease = await original.acquireWriteAccess(project.id);
		const draft = { ...project, revision: 1, title: 'Interrupted Motion overwrite' }; await original.saveRecovery(draft, saved.digest, lease);
		const output = await writeMotionscaperDesktopProject(draft, original, first, false, () => original.assertWriteAccess(lease));
		assert.ok(output && typeof output === 'object' && output.kind === 'motion-native-save');
		await original.prepareNativeSave(draft, saved.digest, lease, output.receipt); await first.dispose(); now += 16000;
		assert.equal(await openMotionscaperDesktopProject(session, second, opaque => { retained = opaque; }), 'opaque'); assert.ok(retained);
		assert.equal(await restarted.loadNativeSave(project.id), null); assert.equal((await restarted.load(project.id))?.digest, saved.digest);
		assert.equal((await restarted.loadRecovery(project.id))?.title, draft.title); assert.equal(session.getSnapshot().project, null);
		await retained.close(); assert.equal(await readMotionSaveJournal(path), null); assert.deepEqual(new Uint8Array(await readFile(path)), bytes);
	} finally {
		await retained?.close().catch(() => undefined); await clearTestReservations(factory);
		await Promise.allSettled([session.dispose(), first.dispose(), second.dispose()]);
		await Promise.allSettled([original.close(), restarted.close()]); await rm(directory, { recursive: true, force: true });
	}
});
