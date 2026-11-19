/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoSessionServiceCurrentV1 as Main } from '../desktop/lightscaper-native-photo-session-service-current-v1.ts';
import { createDesktopPhotoLibrarySessionServiceCurrentV1 as client } from '../src/lightscaper/desktop-photo-library-session-client-current-v1.ts';
import { createDesktopPhotoLibrarySessionCurrentV1 as runtime } from '../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture, nativeRawOriginalsHashCurrentV1 as hash } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';

void test('Installed native Current File import menu command reaches streamed native RAW proof and genuine selected Catalog/custody publication', { timeout: 15000, concurrency: false }, async context => {
 await fixture(context, async f => {
  await f.native.close(); await f.components.close(); await f.scopes.close();
  const scopes = await Scopes.open({ appDataPath: f.directory, services: { prepareRaw: f.prepare } });
  const main = new Main(scopes), owner = Object.freeze({}), controls = new Map<string, (kind: 'stop' | 'retire') => Promise<void>>();
  const calls: string[] = [], generated = rawRecoveryDngFixtureV1({ variant: 'recovery' }); generated.sensor.fill(0);
  const service = client({ installRetirement(id, handler) { controls.set(id, handler); return () => { controls.delete(id); }; },
   async invoke(channel, payload) {
    if (channel === channels.open) {
     assert.ok(payload && typeof payload === 'object'); const id = Reflect.get(payload, 'openId') as string, retire = controls.get(id); assert.ok(retire);
     return main.open(owner, payload, { close: () => retire('retire') });
    }
    if (channel === channels.rawInput || channel === channels.rawOpen) {
     assert.ok(payload && typeof payload === 'object'); const packet: unknown = Reflect.get(payload, 'payload'); assert.ok(packet && typeof packet === 'object');
     if (channel === channels.rawInput) calls.push(String(Reflect.get(packet, 'operation')));
     else { const request: unknown = Reflect.get(packet, 'request'); assert.ok(request && typeof request === 'object'); calls.push(`open:${String(Reflect.get(request, 'kind'))}`); }
    }
    return main.dispatch(channel, owner, payload);
   } });
  let session: Awaited<ReturnType<typeof runtime>> | undefined, failed = false, primary: unknown;
  try {
   session = await f.track(runtime({ name: 'Installed native File import', service, signal: f.signal, originalSourceOptions: { storage: f.storage.storage } }));
   await session.readPage(); const catalogId = f.photo.catalogId;
   // This is the actual Current Session command used by File > Import, with
   // its production preparation and native client ports captured by runtime.
   const items = await f.track(session.importFiles([new File([generated.bytes], 'Installed native.DNG', { type: 'application/octet-stream', lastModified: 0 })]));
   assert.equal(items.length, 1); assert.equal(items[0]?.status, 'imported'); const photoId = items[0]?.photoId; assert.ok(photoId);
   assert.equal(f.state.starts, 1); assert.equal(f.activeChildren(), 0);
   for (const operation of ['available', 'begin', 'write', 'finish', 'open:input', 'close']) assert.ok(calls.includes(operation), `Actual native input operation ${operation} must be reached.`);
   await session.close(); await main.closeAll();
   const selected = await scopes.openSelected({ name: 'Inspect installed import' }), components = await scopes.openComponents(selected.scope);
   try {
    const photo = await components.catalog.loadPhoto(catalogId, photoId); assert.ok(photo);
    assert.equal(photo.original.name, 'Installed native.DNG'); assert.equal(photo.original.contentSha256, hash(generated.bytes));
    assert.equal(photo.original.byteLength, generated.bytes.byteLength); assert.equal(photo.original.width, generated.width); assert.equal(photo.original.height, generated.height);
    await components.media.verifyOriginal(photo.original);
    const roots = await components.media.catalogOriginals.readPage({ catalogId }); assert.ok(roots.roots.some(root => root.photoId === photoId));
   } finally { await components.close(); }
  } catch (error) { failed = true; primary = error; }
  generated.bytes.fill(0); const results = await Promise.allSettled([session?.close(), main.closeAll()]);
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
  try { await scopes.close(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Installed native import actual owners did not retire.', { cause: errors[0] });
  if (failed) throw primary;
 });
});
