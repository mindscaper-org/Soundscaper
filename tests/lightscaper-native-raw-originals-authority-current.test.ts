/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LightscaperNativePhotoRawOriginalsCurrentV1 as Native, captureLightscaperNativePhotoRawOriginalsCurrentV1 as capture } from '../desktop/lightscaper-native-photo-raw-originals-current-v1.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';

void test('Native RAW facet capture refuses forged and proxy owners before borrowed reflection', { timeout: 15_000 }, () => {
 let reflected = 0;
 const poisoned = new Proxy({}, { get() { reflected++; throw new Error('Borrowed property trap.'); }, getPrototypeOf() { reflected++; throw new Error('Borrowed prototype trap.'); } });
 for (const value of [undefined, null, {}, Object.create(Native.prototype) as unknown, poisoned]) assert.throws(() => capture(value));
 assert.equal(reflected, 0);
});

void test('Native RAW genuine capture retains originally issued facet across public replacement and actual decoding', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const owner = f.native, issued = capture(owner), descriptor = Object.getOwnPropertyDescriptor(owner, 'raw'); assert.ok(descriptor);
  assert.equal(issued, f.raw); let reflected = 0;
  Object.defineProperty(owner, 'raw', { configurable: true, get() { reflected++; throw new Error('Replaced public RAW facet.'); } });
  try {
   assert.equal(capture(owner), issued); assert.throws(() => capture(new Proxy(owner, {})));
   const result = await f.track(issued.withFrame(f.request(), view => view.frame.descriptor.width, { signal: f.signal }));
   assert.equal(result.outcome, 'native'); if (result.outcome === 'native') assert.equal(result.value, f.photo.original.width);
   assert.equal(reflected, 0); assert.equal(f.state.starts, 1); assert.equal(f.activeChildren(), 0);
  } finally { Object.defineProperty(owner, 'raw', descriptor); }
 });
});
