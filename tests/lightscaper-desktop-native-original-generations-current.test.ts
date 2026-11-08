/* SPDX-License-Identifier: AGPL-3.0-only */
import { dirname, join } from 'node:path';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { assert, consume, retire, readHead, switchHead, Store, digestCurrentV1 as digest, generationChunksCurrentV1 as chunks,
	nativeOriginalGenerationFixtureCurrentV1 as fixture, GENERATION_OPTIONS_CURRENT_V1 as options } from './helpers/lightscaper-native-original-generation-fixture-current.ts';
import { remainsPending } from './helpers/async-test-control.ts';

void test('Lightscaper fresh repair file precedes head authority and preserves corrupt legacy bytes', options, async context => {
	await fixture(context, async f => {
	 const corrupt = new Uint8Array(f.bytes.length).fill(7); await writeFile(f.path, corrupt);
	 const before = await stat(f.path, { bigint: true }); const expected = readHead(f.db, f.binding);
	 const proof = await f.store.prepareRepairBinding(f.binding, chunks(f.bytes), { signal: f.signal, expectedHead: expected });
	 try {
	  assert.equal(readHead(f.db, f.binding).revision, null); assert.equal(digest(await readFile(f.path)), digest(corrupt));
	  f.db.exec('BEGIN IMMEDIATE'); const capture = consume(proof, f.db); switchHead(f.db, capture.binding, capture.expectedHead, capture.locatorId); f.db.exec('COMMIT');
	  const head = readHead(f.db, f.binding); assert.equal(head.layout, 'generation-v1');
	  const path = join(dirname(f.path), `${f.binding.contentSha256}.${head.locatorId}.body`);
	  assert.equal(digest(await readFile(path)), f.binding.contentSha256); assert.equal((await stat(f.path, { bigint: true })).ino, before.ino);
	  await f.store.verifyBinding(f.binding); assert.equal(digest(await f.store.readBinding(f.binding, 0, f.bytes.length)), f.binding.contentSha256);
	  assert.deepEqual(await f.store.inspectBinding(f.binding), { status: 'present' });
	 } finally { if (f.db.isTransaction) f.db.exec('ROLLBACK'); retire(proof); }
	});
});

void test('Lightscaper whole physical lease never redirects after a repaired head and fresh wrappers resolve the head', options, async context => {
	await fixture(context, async f => {
	 const old = f.lease(); assert.equal(digest(await old.read(0, f.bytes.length)), f.binding.contentSha256);
	 await f.repair(); await rm(f.path);
	 await assert.rejects(old.read(0, 1)); const fresh = f.lease(); assert.equal(digest(await fresh.read(0, f.bytes.length)), f.binding.contentSha256);
	 await f.store.storeBinding({ ...f.binding, storageKey: 'second-asset' }, chunks(f.bytes));
	 await assert.rejects(readFile(f.path), { code: 'ENOENT' });
	 await f.store.close(); const reopened = await Store.open({ appDataPath: f.appDataPath });
	 try { await reopened.verifyBinding(f.binding); assert.equal(digest(await reopened.readBinding(f.binding, 0, f.bytes.length)), f.binding.contentSha256); }
	 finally { await reopened.close(); }
	});
});

void test('Lightscaper prepared generation proofs require their real transaction, namespace and exact one use', options, async context => {
	await fixture(context, async f => {
	 const proof = await f.store.prepareRepairBinding(f.binding, chunks(f.bytes), { signal: f.signal });
	 try {
	  assert.throws(() => consume(proof, f.db)); assert.throws(() => consume(new Proxy(proof, {}), f.db));
	  f.db.exec('BEGIN IMMEDIATE'); const captured = consume(proof, f.db); assert.throws(() => consume(proof, f.db));
	  switchHead(f.db, captured.binding, captured.expectedHead, captured.locatorId); f.db.exec('COMMIT');
	 } finally { if (f.db.isTransaction) f.db.exec('ROLLBACK'); retire(proof); retire(proof); }
	 assert.equal(readHead(f.db, f.binding).revision, 0);
	});
});

void test('Lightscaper abandoned repair proof releases admission without deleting its immutable candidate', options, async context => {
	await fixture(context, async f => {
	 const proof = await f.store.prepareRepairBinding(f.binding, chunks(f.bytes), { signal: f.signal });
	 const before = (await readdir(dirname(f.path))).filter(name => name.endsWith('.body')).length; retire(proof); retire(proof);
	 await f.repair(); assert.equal((await readdir(dirname(f.path))).filter(name => name.endsWith('.body')).length, before + 1);
	 assert.equal(readHead(f.db, f.binding).revision, 0);
	});
});

void test('Lightscaper failed repair writes preserve old head and leave no stage files', options, async context => {
	await fixture(context, async f => {
	 const before = readHead(f.db, f.binding);
	 for (const bytes of [f.bytes.subarray(1), new Uint8Array(f.bytes.length).fill(9), new Uint8Array(f.bytes.length + 1)]) {
	  await assert.rejects(f.store.prepareRepairBinding(f.binding, chunks(bytes), { signal: f.signal }));
	  assert.deepEqual(readHead(f.db, f.binding), before); await f.store.verifyBinding(f.binding);
	 }
	});
});

void test('Lightscaper repeated unpublished generations hit durable nine-descriptor pressure across reopen', options, async context => {
	await fixture(context, async f => {
	 for (let index = 0; index < 9; index++) { context.signal.throwIfAborted(); const proof = await f.store.prepareRepairBinding(f.binding, chunks(f.bytes)); retire(proof); }
	 let reflected = false; const producer = { [Symbol.asyncIterator]() { reflected = true; return chunks(f.bytes); } };
	 await assert.rejects(f.store.prepareRepairBinding(f.binding, producer)); assert.equal(reflected, false);
	 await f.store.close(); const next = await Store.open({ appDataPath: f.appDataPath });
	 try { await assert.rejects(next.prepareRepairBinding(f.binding, chunks(f.bytes))); await next.verifyBinding(f.binding); }
	 finally { await next.close(); }
	});
});

void test('Lightscaper repair expected-head capture refuses a second-connection winner without touching it', options, async context => {
	await fixture(context, async f => {
	 const expected = readHead(f.db, f.binding); await f.repair(); const winner = readHead(f.db, f.binding);
	 await assert.rejects(f.store.prepareRepairBinding(f.binding, chunks(f.bytes), { expectedHead: expected }));
	 assert.deepEqual(readHead(f.db, f.binding), winner); await f.store.verifyBinding(f.binding);
	});
});

void test('Lightscaper physical lease closes only after its accepted real file read joins', options, async context => {
	await fixture(context, async f => { await f.hold(async gate => {
	 const lease = f.lease(), work = f.track(lease.read(0, f.bytes.length, { signal: f.signal })); let closing: Promise<void> | undefined;
	 try { await gate.entered; context.signal.throwIfAborted(); closing = lease.close(); assert.equal(await remainsPending(closing), true);
	  await assert.rejects(lease.read(0, 1)); gate.release(); assert.equal(digest(await work), f.binding.contentSha256); await closing;
	 } finally { gate.release(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
	}); });
});

void test('Lightscaper physical reads are independent of an idle upload tail and enforce copied bounded outputs', options, async context => {
	await fixture(context, async f => {
	 const lease = f.lease(); const bytes = await lease.read(0, 3); bytes.fill(0);
	 assert.equal(digest(await lease.read(0, 3)), digest(f.bytes.subarray(0, 3)));
	 for (const [offset, length] of [[-0, 1], [-1, 1], [0, 0], [0, 1024 * 1024 + 1], [f.bytes.length, 1]]) await assert.rejects(lease.read(offset, length));
	});
});

void test('Lightscaper physical lease admission fences closed owners before borrowed binding reflection', options, async context => {
	await fixture(context, async f => {
	 await f.store.close(); let reflected = false;
	 const value = new Proxy({}, { ownKeys() { reflected = true; return []; } }); assert.throws(() => f.store.acquireBindingRead(value)); assert.equal(reflected, false);
	});
});
