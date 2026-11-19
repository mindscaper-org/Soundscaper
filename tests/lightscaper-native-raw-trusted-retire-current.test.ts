/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { nativeRawRoleFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-raw-role-fixture-current.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
function input(): Uint8Array<ArrayBuffer> { const value = rawDngFixtureV1(); value.sensor.fill(0); return value.bytes; }
void test('RAW forced retirement delegates once to the actual trusted owner and retains job until held close joins', { timeout: 15000, concurrency: false }, async context => {
 await fixture(context, input(), async f => {
  const entered = f.gate(), releaseRead = f.gate(), retiring = f.gate(), releaseRetire = f.gate();
  let calls = 0, settled = false, closed = false;
  const owner = f.create({ async retire() {
   calls++; retiring.release(); await releaseRetire.promise; f.kill();
   while (f.activeChildren()) { f.signal.throwIfAborted(); await setImmediate(); }
  } });
  f.state.onRead = async () => { entered.release(); await releaseRead.promise; };
  const caller = new AbortController(), reason = Symbol('trusted RAW stop');
  const work = f.track(owner.withDecoded(f.request(), () => assert.fail('Cancelled native job has no consumer.'), { signal: caller.signal }));
  void work.then(() => { settled = true; }, () => { settled = true; });
  try {
   await f.reached(entered.promise); caller.abort(reason); const close = f.track(owner.close()); void close.then(() => { closed = true; }, () => { closed = true; });
   await f.reached(retiring.promise); releaseRead.release(); await setImmediate();
   assert.equal(calls, 1); assert.equal(settled, false); assert.equal(closed, false);
   const other = f.create(); let reflected = 0;
   await assert.rejects(f.track(other.withDecoded(new Proxy({}, { ownKeys() { reflected++; throw new Error('Capacity must be booked.'); } }), () => undefined)));
   assert.equal(reflected, 0); releaseRetire.release();
   await work.then(() => assert.fail('Cancelled source must reject.'), (error: unknown) => { assert.equal(error, reason); }); await close;
   assert.equal(calls, 1); assert.equal(f.activeChildren(), 0); assert.equal(f.state.alerts, 0);
  } finally { releaseRead.release(); releaseRetire.release(); }
 });
});
void test('RAW successful release joins trusted actual cleanup before pixel consumer without changing native success', { timeout: 15000, concurrency: false }, async context => {
 await fixture(context, input(), async f => {
  const retiring = f.gate(), release = f.gate(); let calls = 0, consumed = false, settled = false;
  const owner = f.create({ async retire() {
   calls++; assert.equal(f.activeChildren(), 0, 'Normal retirement first joins the actual successful native peer.'); retiring.release(); await release.promise;
  } });
  const work = f.track(owner.withDecoded(f.request(), view => { consumed = true; assert.equal(view.width, 32); assert.equal(view.height, 32); assert.equal(f.activeChildren(), 0); }));
  void work.then(() => { settled = true; }, () => { settled = true; });
  try { await f.reached(retiring.promise); await setImmediate(); assert.equal(calls, 1); assert.equal(consumed, false); assert.equal(settled, false); }
  finally { release.release(); }
  await work; await owner.close(); assert.equal(calls, 1); assert.equal(consumed, true); assert.equal(f.state.alerts, 0);
 });
});
