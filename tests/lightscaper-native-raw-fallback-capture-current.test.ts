/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoSessionServiceCurrentV1 as Main } from '../desktop/lightscaper-native-photo-session-service-current-v1.ts';
import { createDesktopPhotoLibrarySessionServiceCurrentV1 as client } from '../src/lightscaper/desktop-photo-library-session-client-current-v1.ts';
import { createDesktopPhotoLibrarySessionCurrentV1 as runtime } from '../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';

void test('Actual Current canonical whole Web fallback retains the original Photo request captured before native availability resolves', { timeout: 15000, concurrency: false }, async context => {
 await fixture(context, async f => {
  const workers = await rawWorkerFixtureV1(), wasm = new Uint8Array(await readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url)));
  await f.native.close(); await f.components.close(); await f.scopes.close();
  // The actual Main producer explicitly has no available decoder. It still
  // authenticates the stored Photo/Original through the genuine native Reader.
  let preparations = 0;
  const scopes = await Scopes.open({ appDataPath: f.directory, services: { prepareRaw: () => { preparations++; return Promise.resolve(undefined); } } });
  const main = new Main(scopes), owner = Object.freeze({}), controls = new Map<string, (kind: 'stop' | 'retire') => Promise<void>>();
  const entered = f.gate(), release = f.gate(); let armed = true;
  const service = client({ installRetirement(id, handler) { controls.set(id, handler); return () => { controls.delete(id); }; },
   async invoke(channel, payload) {
    if (channel === channels.open) {
     assert.ok(payload && typeof payload === 'object'); const id = Reflect.get(payload, 'openId') as string, retire = controls.get(id); assert.ok(retire);
     return main.open(owner, payload, { close: () => retire('retire') });
    }
    const actual = await main.dispatch(channel, owner, payload);
    if (channel === channels.rawOpen && armed) { armed = false; assert.deepEqual(actual, { outcome: 'web-fallback', reason: 'native-unavailable' }); entered.release(); await release.promise; }
    return actual;
   } });
  const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker'), fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function () { return workers.createWorker(); } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: (value: RequestInfo | URL) => {
   assert.match(String(value), /\/runtime\/libraw\/0\.22\.2\/libraw\.wasm$/u); return Promise.resolve(new Response(wasm, { status: 200 }));
  } });
  const cancel = (): void => { release.release(); void workers.close().catch(() => undefined); };
  context.signal.addEventListener('abort', cancel, { once: true }); f.signal.addEventListener('abort', cancel, { once: true });
  let session: Awaited<ReturnType<typeof runtime>> | undefined, work: Promise<unknown> | undefined, failed = false, primary: unknown;
  try {
   session = await f.track(runtime({ name: 'Captured canonical fallback', service, signal: f.signal, originalSourceOptions: { storage: f.storage.storage } }));
   const port = session.develop.original; assert.ok(port);
   const request = { schemaVersion: 1 as const, photoId: f.photo.id, expectedRevision: f.photo.revision }; let delivered = 0;
   work = f.track(port.withFrame(request, view => {
    delivered++; assert.equal(view.photoId, f.photo.id); assert.equal(view.revision, f.photo.revision);
    assert.equal(view.frame.descriptor.width, f.photo.original.width); assert.equal(view.frame.descriptor.height, f.photo.original.height);
    assert.equal(view.frame.descriptor.sampleFormat, 'unorm16'); assert.ok(view.frame.pixels.some(sample => sample !== 0));
   })); void work.catch(() => undefined);
   await f.reached(entered.promise, work); request.photoId = 'missing-retargeted-photo'; request.expectedRevision++;
   release.release(); await work; assert.equal(delivered, 1); assert.equal(preparations, 1);
   assert.equal(f.state.starts, 0); assert.equal(workers.statistics.created, 1); assert.equal(workers.active(), 0);
  } catch (error) { failed = true; primary = error; }
  cancel(); await Promise.allSettled([work]); const results = await Promise.allSettled([session?.close(), main.closeAll(), workers.close()]);
  for (const [key, descriptor] of [['Worker', workerDescriptor], ['fetch', fetchDescriptor]] as const) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  wasm.fill(0); context.signal.removeEventListener('abort', cancel); f.signal.removeEventListener('abort', cancel);
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
  try { await scopes.close(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Actual native/Web fallback owners did not retire.', { cause: errors[0] });
  if (failed) throw primary;
 });
});
