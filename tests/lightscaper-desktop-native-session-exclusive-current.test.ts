/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import { assert, remainsPending, nativeSessionExclusiveFixtureCurrentV1 as fixture,
	EXCLUSIVE_OPTIONS_CURRENT_V1 as options } from './helpers/lightscaper-native-session-exclusive-fixture-current.ts';
const CHECK = AbortSignal.prototype.throwIfAborted;

void test('Lightscaper native selected exclusive callback publishes real Catalog and Settings changes across reopen', options, async context => {
	await fixture(context, async f => {
	 const exclusive = f.lease.exclusive, catalogId = f.lease.catalogId;
	 const receipt = await f.track(exclusive(catalogId, async signal => {
	  assert.ok(signal instanceof AbortSignal); Reflect.apply(CHECK, signal, []);
	  const root = await f.lease.components.catalog.loadCatalog(catalogId); assert.ok(root);
	  const saved = await f.lease.components.catalog.saveCatalog({ ...root, name: 'Exclusive durable name' }, root.revision, { signal });
	  const settings = f.lease.components.settings.settingsRepository;
	  assert.equal(await settings.putIfAbsent('exclusive:proof', { step: 1 }), true);
	  assert.equal(await settings.replaceIfCurrent('exclusive:proof', { step: 1 }, { step: 2 }), true);
	  return saved;
	 }, f.signal));
	 assert.equal(receipt.name, 'Exclusive durable name'); const reopened = await f.reopen();
	 assert.equal((await reopened.components.catalog.loadCatalog(catalogId))?.name, receipt.name);
	 assert.deepEqual(await reopened.components.settings.settingsRepository.get('exclusive:proof'), { step: 2 });
	});
});

void test('Lightscaper native exclusive refuses overlap before borrowed callback or signal reflection', options, async context => {
	await fixture(context, async f => {
	 const gate = f.gate(); const work = f.track(f.lease.exclusive(f.lease.catalogId, async signal => {
	  const root = await f.lease.components.catalog.loadCatalog(f.lease.catalogId); assert.ok(root); Reflect.apply(CHECK, signal, []);
	  gate.enter(); await gate.wait; return root.id;
	 }, f.signal));
	 let reflected = 0, invoked = 0;
	 const callback = new Proxy(async () => { invoked++; return 'unexpected'; }, { get() { reflected++; throw new Error('Borrowed callback property.'); } });
	 const source = new Proxy(new AbortController().signal, { ownKeys() { reflected++; throw new Error('Borrowed signal keys.'); },
	  getOwnPropertyDescriptor() { reflected++; throw new Error('Borrowed signal descriptor.'); }, getPrototypeOf() { reflected++; throw new Error('Borrowed signal prototype.'); } });
	 try { await gate.entered; context.signal.throwIfAborted(); await assert.rejects(f.lease.exclusive(f.lease.catalogId, callback, source));
	  assert.equal(reflected, 0); assert.equal(invoked, 0); assert.equal(await remainsPending(work), true); gate.release(); assert.equal(await work, f.lease.catalogId);
	 } finally { gate.release(); await Promise.allSettled([work]); }
	});
});

void test('Lightscaper native exclusive rejects a nested callback without queueing behind itself', options, async context => {
	await fixture(context, async f => {
	 let nested = false;
	 const value = await f.track(f.lease.exclusive(f.lease.catalogId, async () => {
	  await assert.rejects(f.lease.exclusive(f.lease.catalogId, async () => { nested = true; }));
	  assert.equal(await f.lease.components.settings.settingsRepository.putIfAbsent('exclusive:nested', 'outer'), true); return 'outer';
	 }, f.signal));
	 assert.equal(value, 'outer'); assert.equal(nested, false);
	});
});

void test('Lightscaper native exclusive joins a held callback after opaque caller cancellation and close', options, async context => {
	await fixture(context, async f => {
	 const gate = f.gate(), caller = new AbortController(); let inspected = 0;
	 const reason = Object.defineProperty(Object.create(null) as object, 'then', { get() { inspected++; throw new Error('Opaque reason must not be assimilated.'); } });
	 const work = f.track(f.lease.exclusive(f.lease.catalogId, async signal => {
	  await f.lease.components.catalog.loadCatalog(f.lease.catalogId); gate.enter(); await gate.wait; Reflect.apply(CHECK, signal, []);
	 }, caller.signal));
	 const rejected = work.then(() => { assert.fail('Cancelled callback succeeded.'); }, (actual: unknown) => { assert.equal(actual, reason); });
	 let closing: Promise<void> | undefined;
	 try { await gate.entered; context.signal.throwIfAborted(); caller.abort(reason); closing = f.lease.close();
	  assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
	  gate.release(); await rejected; await closing; assert.equal(inspected, 0);
	 } finally { gate.release(); await Promise.allSettled([work, rejected, ...(closing ? [closing] : [])]); }
	});
});

void test('Lightscaper native exclusive callback opaque failure does not inspect its reason or poison the next writer', options, async context => {
	await fixture(context, async f => {
	 let inspected = 0; const reason = Object.defineProperty(Object.create(null) as object, 'then', { get() { inspected++; throw new Error('Opaque callback failure inspected.'); } });
	 await f.track(f.lease.exclusive(f.lease.catalogId, async () => { throw reason; }, f.signal)).then(() => { assert.fail('Callback should reject.'); }, (actual: unknown) => { assert.equal(actual, reason); });
	 assert.equal(inspected, 0);
	 assert.equal(await f.track(f.lease.exclusive(f.lease.catalogId, () => f.lease.components.settings.settingsRepository.putIfAbsent('exclusive:after-failure', true), f.signal)), true);
	});
});

void test('Lightscaper native exclusive preserves an actual durable callback ACK after late cancellation and local stop', options, async context => {
	await fixture(context, async f => {
	 const caller = new AbortController(), reason = Symbol('after real Catalog ACK');
	 const saved = await f.track(f.lease.exclusive(f.lease.catalogId, async signal => {
	  const root = await f.lease.components.catalog.loadCatalog(f.lease.catalogId); assert.ok(root);
	  const receipt = await f.lease.components.catalog.saveCatalog({ ...root, name: 'Committed before local stop' }, root.revision, { signal });
	  caller.abort(reason); f.lease.stop(); return receipt;
	 }, caller.signal));
	 assert.equal(saved.name, 'Committed before local stop'); const reopened = await f.reopen();
	 assert.equal((await reopened.components.catalog.loadCatalog(reopened.catalogId))?.name, saved.name);
	});
});

void test('Lightscaper selected exclusive wrong catalog never invokes the callback or mutates storage', options, async context => {
	await fixture(context, async f => {
	 let called = false;
	 await assert.rejects(f.lease.exclusive('different-catalog', async () => { called = true; })); assert.equal(called, false);
	 assert.equal(await f.track(f.lease.exclusive(f.lease.catalogId, () => f.lease.components.settings.settingsRepository.putIfAbsent('exclusive:right-catalog', true), f.signal)), true);
	});
});

void test('Lightscaper selected exclusive keeps first opaque cancellation when stopped before callback start', options, async context => {
	await fixture(context, async f => {
	 const caller = new AbortController(), reason = Symbol('first before callback start'); let called = false;
	 const work = f.track(f.lease.exclusive(f.lease.catalogId, async () => { called = true; }, caller.signal));
	 const observed = work.then(() => { assert.fail('Cancelled admission succeeded.'); }, (actual: unknown) => { assert.equal(actual, reason); });
	 caller.abort(reason); f.lease.stop(); await observed; assert.equal(called, false);
	});
});
