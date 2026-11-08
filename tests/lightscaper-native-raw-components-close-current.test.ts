/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoOriginalsCurrentV1 as Originals } from '../desktop/lightscaper-native-photo-originals-current-v1.ts';
import { LightscaperNativeOriginalStoreCurrentV1 as Store } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture, nativeRawOriginalsHashCurrentV1 as hash } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';

void test('Actual component RAW retirement starts idle writer quiescence before joining a RAW admission queued behind native publication', { timeout: 15000, concurrency: false }, async context => {
 await fixture(context, async f => {
  await f.native.close(); await f.components.close(); await f.scopes.close();
  const scopes = await Scopes.open({ appDataPath: f.directory, services: { prepareRaw: f.prepare } });
  const selected = await scopes.openSelected({ name: 'RAW close dependency' }), admission = f.gate();
  const createDescriptor = Object.getOwnPropertyDescriptor(Originals, 'create'); assert.ok(createDescriptor); const create = Originals.create;
  const captureAdmission: typeof Originals.create = options => {
   const acquireDescriptor = Object.getOwnPropertyDescriptor(options.media, 'acquireOriginalRead'); assert.ok(acquireDescriptor); const acquire = options.media.acquireOriginalRead;
   const observe: typeof acquire = (...args) => { const pending = Reflect.apply(acquire, options.media, args) as ReturnType<typeof acquire>; admission.release(); return pending; };
   Object.defineProperty(options.media, 'acquireOriginalRead', { ...acquireDescriptor, value: observe });
   try { return Reflect.apply(create, Originals, [options]) as ReturnType<typeof create>; }
   finally { Object.defineProperty(options.media, 'acquireOriginalRead', acquireDescriptor); }
  };
  Object.defineProperty(Originals, 'create', { ...createDescriptor, value: captureAdmission });
  const components = await scopes.openComponents(selected.scope).finally(() => { Object.defineProperty(Originals, 'create', createDescriptor); });
  assert.ok(components.rawParts);
  const incoming = Uint8Array.of(9, 8), writer = await components.media.beginAssetWrite('raw-close-idle', {}, { expectedBytes: incoming.byteLength, expectedSha256: hash(incoming) });
  const entered = f.gate(), descriptor = Object.getOwnPropertyDescriptor(Store.prototype, 'storeBinding'); assert.ok(descriptor);
  const actual = descriptor.value as Store['storeBinding'];
  const observe: Store['storeBinding'] = function (this: Store, binding, chunks, options) {
   const pending = Reflect.apply(actual, this, [binding, chunks, options]) as ReturnType<Store['storeBinding']>;
   if (binding && typeof binding === 'object' && 'storageKey' in binding && binding.storageKey === 'raw-close-blocked') entered.release(); return pending;
  };
  let publishing: Promise<unknown> | undefined, reading: Promise<unknown> | undefined, closing: Promise<void> | undefined;
  const cancel = (): void => { entered.release(); void writer.abort().catch(() => undefined); void components.close().catch(() => undefined); };
  context.signal.addEventListener('abort', cancel, { once: true }); f.signal.addEventListener('abort', cancel, { once: true });
  Object.defineProperty(Store.prototype, 'storeBinding', { ...descriptor, value: observe });
  try {
   publishing = f.track(components.media.writeAsset('raw-close-blocked', new Blob([Uint8Array.of(3)]), {})); void publishing.catch(() => undefined);
   await f.reached(entered.promise, publishing);
   reading = f.track(components.rawParts.transport.open({ kind: 'frame', request: f.request('canonical', null) }, { signal: f.signal })); void reading.catch(() => undefined);
   await f.reached(admission.promise, reading);
   closing = components.close(); void closing.catch(() => undefined); await setImmediate();
   // This writer must already be fenced even though RAW admission is still
   // behind the ordinary publication. A missing eager quiesce accepts bytes.
   await assert.rejects(writer.write(incoming.subarray(0, 1)));
   await closing; await Promise.allSettled([publishing, reading]); assert.equal(f.activeChildren(), 0);
  } finally {
   cancel(); await writer.abort(); await Promise.allSettled([publishing, reading, closing]);
   Object.defineProperty(Store.prototype, 'storeBinding', descriptor);
   context.signal.removeEventListener('abort', cancel); f.signal.removeEventListener('abort', cancel);
   await components.close(); await scopes.close();
  }
 });
});
