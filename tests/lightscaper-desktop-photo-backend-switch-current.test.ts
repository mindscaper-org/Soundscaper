/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperPhotoBackendSwitchCurrentV1 as Switch } from '../src/common/editor/controller/composition/lightscaper-photo-backend-switch-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

for (const safety of ['busy', 'open-surface'] as const) void test(`Backend opt-in veto preserves ${safety} without fencing or choosing another factory`, async () => {
 const chosen: string[] = [], owner = new Switch({ nativeAvailable: true }); let fences = 0, closes = 0;
 const registration = owner.register({ safety: () => safety, fence: () => { fences++; }, retireAndJoin: async () => { closes++; }, target: null });
 const detach = owner.subscribe(() => { chosen.push(owner.snapshot().backend); });
 try { assert.equal(await owner.select('native'), false); assert.equal(owner.snapshot().backend, 'web'); assert.equal(owner.snapshot().epoch, 0); assert.equal(fences, 0); assert.equal(closes, 0); assert.ok(chosen.every(value => value === 'web')); }
 finally { detach(); registration(); await owner.close(); }
});

void test('Matched backend changes only after exact workspace fence and actual retirement joins; duplicate demand has one owner', { timeout: 15_000 }, async context => {
 const owner = new Switch({ nativeAvailable: true }), held = deferred<void>(), entered = deferred<void>(); let fences = 0, closes = 0;
 const cancel = (): void => { held.resolve(); entered.resolve(); }; context.signal.addEventListener('abort', cancel, { once: true });
 const registration = owner.register({ safety: () => 'ready', fence: () => { fences++; }, retireAndJoin: async () => { closes++; entered.resolve(); await held.promise; }, target: null });
 let work: Promise<boolean> | undefined;
 try {
  work = owner.select('native'); assert.equal(owner.select('native'), work); assert.equal(fences, 1); await entered.promise; context.signal.throwIfAborted();
  assert.equal(owner.snapshot().backend, 'web'); assert.equal(owner.snapshot().busy, true); assert.equal(await remainsPending(work), true);
  assert.equal(await owner.select('web'), false); held.resolve(); assert.equal(await work, true); assert.equal(closes, 1);
  assert.equal(owner.snapshot().backend, 'native'); assert.equal(owner.snapshot().epoch, 1); assert.equal(owner.snapshot().ready, false);
 } finally { held.resolve(); await work; registration(); await owner.close(); context.signal.removeEventListener('abort', cancel); }
});

void test('Failed workspace cleanup is retained, never selects native or reopens a partially retired Web workspace', async () => {
 const reason = Object.freeze(Object.create(null) as object), owner = new Switch({ nativeAvailable: true }); let closes = 0;
 const registration = owner.register({ safety: () => 'ready', fence() {}, retireAndJoin: async () => { closes++; throw reason; }, target: null });
 let caught = false; try { await owner.select('native'); } catch (error) { caught = true; assert.ok(Object.is(error, reason)); }
 assert.equal(caught, true); assert.equal(owner.snapshot().backend, 'web'); assert.equal(owner.snapshot().failed, true); assert.equal(closes, 1);
 await assert.rejects(owner.select('native')); registration(); await assert.rejects(owner.close()); assert.equal(closes, 1);
});

void test('Switch books ownership before safety/fence reentry, and missing matched native transport never retires Web', async () => {
 const unavailable = new Switch({ nativeAvailable: false }); let touches = 0;
 const off = unavailable.register({ safety: () => { touches++; return 'ready'; }, fence: () => { touches++; }, retireAndJoin: async () => { touches++; }, target: null });
 const before = touches; assert.equal(await unavailable.select('native'), false); assert.equal(touches, before); off(); await unavailable.close();
 const owner = new Switch({ nativeAvailable: true }); let nested: Promise<boolean> | undefined;
 const unregister = owner.register({ safety: () => 'ready', fence: () => { nested = owner.select('native'); }, retireAndJoin: async () => {}, target: null });
 const work = owner.select('native'); assert.equal(nested, work); await work; unregister(); await owner.close();
});
