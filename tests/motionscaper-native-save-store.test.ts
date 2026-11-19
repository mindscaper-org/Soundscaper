/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
const receipt = { name: 'saved.mscape', byteLength: 123, sha256: 'a'.repeat(64), transactionId: 'transaction-1', publication: 'prepared' as const };
async function fixture() {
	let now = 1000; const database = createInstrumentedIndexedDB();
	const store = createMotionscaperProjectStore({ indexedDB: database as unknown as IDBFactory, now: () => now });
	const project = createMotionscaperProject({ id: 'prepared-owner', compositionId: 'main', title: 'Saved' });
	const base = await store.save(project, null), lease = await store.acquireWriteAccess(project.id);
	const candidate = { ...project, revision: 1, title: 'Draft' }; await store.saveRecovery(candidate, base.digest, lease);
	return { database, store, project, base, candidate, lease, expire() { now += 16000; }, now: () => now };
}
test('native preparation reserves the exact saved head without publishing or losing recovery and activates once', async () => {
	const f = await fixture(); const events: string[] = []; f.store.subscribeSaved(value => events.push(value.digest));
	try {
		const prepared = await f.store.prepareNativeSave(f.candidate, f.base.digest, f.lease, receipt);
		assert.equal((await f.store.load(f.project.id))?.digest, f.base.digest);
		assert.equal((await f.store.loadRecovery(f.project.id))?.title, 'Draft'); assert.deepEqual(events, []);
		assert.deepEqual(await f.store.loadNativeSave(f.project.id), prepared);
		await assert.rejects(f.store.save(f.candidate, f.base.digest, f.lease), /prepared native Save/u);
		await assert.rejects(f.store.saveRecovery(f.candidate, f.base.digest, f.lease), /prepared native Save/u);
		await assert.rejects(f.store.releaseWriteAccess(f.lease), /native Save/u);
		await assert.rejects(f.store.close(), /native Save/u);
		const published = { ...receipt, publication: 'published' as const };
		const saved = await f.store.finalizeNativeSave(prepared, published, f.lease);
		await f.store.finalizeNativeSave(prepared, published, f.lease);
		assert.deepEqual(events, [saved.digest]); assert.equal(await f.store.loadNativeSave(f.project.id), null);
		assert.equal((await f.store.load(f.project.id))?.digest, saved.digest); assert.equal(await f.store.loadRecovery(f.project.id), null);
	} finally { await f.store.close(); }
});
test('a failed native preparation leaves the saved head, recovery and reservation atomically unchanged', async () => {
	const f = await fixture();
	try {
		f.database.failNextPutForStore('projects', new Error('reservation quota'));
		await assert.rejects(f.store.prepareNativeSave(f.candidate, f.base.digest, f.lease, receipt), /reservation quota/u);
		assert.equal(await f.store.loadNativeSave(f.project.id), null);
		assert.equal((await f.store.load(f.project.id))?.digest, f.base.digest);
		assert.equal((await f.store.loadRecovery(f.project.id))?.title, 'Draft');
	} finally { await f.store.close(); }
});
test('recovery requires the matching native outcome and lease before cancelling or activating a prepared head', async () => {
	const f = await fixture(); let second: ReturnType<typeof createMotionscaperProjectStore> | undefined;
	try {
		const prepared = await f.store.prepareNativeSave(f.candidate, f.base.digest, f.lease, receipt);
		await assert.rejects(f.store.cancelNativeSave(prepared, { ...receipt, publication: 'published' }, f.lease), /rolled-back/u);
		f.expire(); second = createMotionscaperProjectStore({ indexedDB: f.database as unknown as IDBFactory, now: f.now });
		const lease = await second.acquireWriteAccess(f.project.id);
		await assert.rejects(second.cancelNativeSave(prepared, { ...receipt, publication: 'rolled-back' }, lease), /changed|another session/iu);
		await second.cancelNativeSave(prepared, { ...receipt, publication: 'rolled-back' }, lease, true);
		assert.equal((await second.load(f.project.id))?.digest, f.base.digest);
		assert.equal((await second.loadRecovery(f.project.id))?.title, 'Draft'); assert.equal(await second.loadNativeSave(f.project.id), null);
	} finally { await second?.close(); await f.store.close(); }
});
