/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { nativeRestoreArchiveCurrentV1 as archive, nativeRestoreJsonShaCurrentV1 as jsonSha } from './helpers/lightscaper-native-library-archive-restore-fixture-current.ts';
import { nativeRestoreTransportFixtureCurrentV1 as fixture, uploadRestoreFixtureCurrentV1 as upload, holdRestoreFileReadCurrentV1 as heldRead,
	loadRestoreRuntimeCurrentV1 as runtime, archiveTransportShaCurrentV1 as sha } from './helpers/lightscaper-native-library-restore-transport-fixture-current.ts';
import { remainsPending } from './helpers/async-test-control.ts';

void test('Native matched restore runtime installs the real complete archive and reopens the selected generation', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await fixture(context, async f => {
	const previous = await f.scopes.openSelected({ name: 'Initial' });
	const { createDesktopPhotoLibraryRestoreRuntimeCurrentV1: create } = await runtime(), owner = create({ name: 'Native restored', transport: f.transport });
	try {
	 await assert.rejects(f.track(owner.restoreArchive(new Blob([Uint8Array.of(1,2,3)]))));
	 assert.equal((await f.scopes.openSelected({ name: 'Unchanged' })).selectionToken, previous.selectionToken);
	 const receipt = await f.track(owner.restoreArchive(source.blob, { signal: f.signal }));
	 assert.equal(receipt.catalogId, source.root.id); assert.equal(receipt.photoCount, 6); assert.equal(receipt.stackCount, 1); assert.equal(receipt.originalCount, 3);
	 const selected = await f.scopes.openSelected({ name: 'Selected' }); assert.notEqual(selected.selectionToken, previous.selectionToken);
	 const c = await f.scopes.openComponents(selected.scope);
	 try { assert.equal(jsonSha(await c.catalog.loadCatalog(source.root.id)), jsonSha(source.root));
		for (const photo of source.photos) assert.equal(jsonSha(await c.catalog.loadPhoto(photo.catalogId, photo.id)), jsonSha(photo));
	 } finally { await c.close(); }
	 assert.equal((await f.files()).length, 0); await owner.close(); await f.reopen();
	 assert.equal((await f.scopes.openSelected({ name: 'Reopened' })).selectionToken, selected.selectionToken);
	} finally { await owner.close(); }
	});
});
void test('Native restore stream books one actual owner before borrowed reflection and refuses foreign IDs', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
	const first = await f.service.begin(f.owner, { name: 'Library', byteLength: 3 }); let reflected = 0;
	const bad = new Proxy({}, { ownKeys() { reflected++; throw new Error('Must not inspect.'); } });
	await assert.rejects(f.service.begin(Object.freeze({}), bad)); await assert.rejects(f.service.write(Object.freeze({}), bad)); assert.equal(reflected, 0);
	await f.service.write(f.owner, { id: first.id, offset: 0, bytes: Uint8Array.of(1,2,3) });
	await assert.rejects(f.service.write(f.owner, { id: first.id, offset: 0, bytes: Uint8Array.of(4) }));
	await f.service.abort(f.owner, { id: first.id }); assert.equal((await f.files()).length, 0);
	const next = await f.service.begin(f.owner, { name: 'Library', byteLength: 1 }); await f.service.abort(f.owner, { id: next.id });
	});
});
void test('Native restore actual length and completed-file SHA reject before any fresh generation allocation', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
	const packet = await upload(f, Uint8Array.of(1,2,3));
	await assert.rejects(f.service.commit(f.owner, { ...packet, contentSha256: '0'.repeat(64) }));
	assert.equal((await f.scopes.readAllocationPage()).allocations.length, 0); assert.equal((await f.files()).length, 0);
	const short = await f.service.begin(f.owner, { name: 'Library', byteLength: 4 }); await f.service.write(f.owner, { id: short.id, offset: 0, bytes: Uint8Array.of(1) });
	await assert.rejects(f.service.commit(f.owner, { id: short.id, contentSha256: sha(Uint8Array.of(1)) }));
	assert.equal((await f.files()).length, 0);
	});
});
void test('Native restore abort and owner close join a held actual file read and release stream capacity', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
	const packet = await upload(f, Uint8Array.of(1,2,3));
	await heldRead(f, async gate => {
	 const work = f.track(f.service.commit(f.owner, packet)), observed = work.then(() => false, () => true);
	 let closing: Promise<void> | undefined;
	 try { await f.reached(gate.entered, work); closing = f.track(f.service.close(f.owner)); assert.equal(await remainsPending(closing), true);
		gate.release(); assert.equal(await observed, true); await closing;
	 } finally { gate.release(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
	});
	assert.equal((await f.files()).length, 0); assert.equal((await f.scopes.readAllocationPage()).allocations.length, 0);
	});
});
void test('Native restore runtime close joins actual Blob bytes and preserves an opaque caller reason', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
	const actual = Blob.prototype.arrayBuffer, entered = f.gate(), leave = f.gate(); let held = false;
	Blob.prototype.arrayBuffer = async function() { if (!held) { held = true; entered.release(); await leave.promise; } return Reflect.apply(actual, this, []) as Promise<ArrayBuffer>; };
	let work: Promise<unknown> | undefined, closing: Promise<void> | undefined;
	const controller = new AbortController(), reason = Symbol('held native archive bytes');
	let owner: ReturnType<(Awaited<ReturnType<typeof runtime>>)['createDesktopPhotoLibraryRestoreRuntimeCurrentV1']> | undefined;
	try {
	 const { createDesktopPhotoLibraryRestoreRuntimeCurrentV1: create } = await runtime(); owner = create({ name: 'Library', transport: f.transport });
	 work = f.track(owner.restoreArchive(new Blob([Uint8Array.of(1,2,3)]), { signal: controller.signal }));
	 const observed = work.then(() => { throw new Error('Expected cancellation.'); }, error => { assert.equal(error, reason); });
	 await f.reached(entered.promise, work); controller.abort(reason); closing = f.track(owner.close()); assert.equal(await remainsPending(closing), true);
	 leave.release(); await observed; await closing;
	} finally { leave.release(); await Promise.allSettled([...(work ? [work] : []), ...(closing ? [closing] : [])]); await owner?.close(); Blob.prototype.arrayBuffer = actual; }
	assert.equal((await f.files()).length, 0);
	});
});
void test('Native restore retains actual publication ACK when the caller cancels at the real anchor COMMIT', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await fixture(context, async f => {
	const actual = DatabaseSync.prototype.exec, controller = new AbortController(); let acknowledged = false;
	DatabaseSync.prototype.exec = function(sql: string): void {
	 Reflect.apply(actual, this, [sql]);
	 if (!acknowledged && /^COMMIT$/iu.test(sql)) {
		const exists = this.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_photo_settings'").get();
		if (exists) { const keys = this.prepare("SELECT key FROM native_photo_settings WHERE scope='anchor'").all();
		 if (keys.some(row => row.key instanceof Uint8Array && Buffer.from(row.key).swap16().toString('utf16le').startsWith('photo-library:native-restore-commit-v1:'))) { acknowledged = true; controller.abort(Symbol('post COMMIT')); }
		}
	 }
	};
	const { createDesktopPhotoLibraryRestoreRuntimeCurrentV1: create } = await runtime(), owner = create({ name: 'Library', transport: f.transport });
	try { const receipt = await f.track(owner.restoreArchive(source.blob, { signal: controller.signal })); assert.equal(acknowledged, true); assert.equal(receipt.photoCount, 6); }
	finally { await owner.close(); DatabaseSync.prototype.exec = actual; }
	});
});
