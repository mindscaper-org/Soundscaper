/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoSessionServiceCurrentV1 as Main } from '../desktop/lightscaper-native-photo-session-service-current-v1.ts';
import { createDesktopPhotoLibrarySessionServiceCurrentV1 as client } from '../src/lightscaper/desktop-photo-library-session-client-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture, nativeRawOriginalsHashCurrentV1 as hash } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';
import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from '../src/lightscaper/desktop-photo-library-session-storage-current-v1.ts';

void test('Installed native RAW input keeps captured cancellation through genuine completed-file ACK and decoded output consumer', { timeout: 15000, concurrency: false }, async context => {
 await fixture(context, async f => {
  await f.native.close(); await f.components.close(); await f.scopes.close();
  const scopes = await Scopes.open({ appDataPath: f.directory, services: { prepareRaw: f.prepare } }), main = new Main(scopes), owner = Object.freeze({});
  const controls = new Map<string, (kind: 'stop' | 'retire') => Promise<void>>(), entered = f.gate(), release = f.gate(); let armed = true, closes = 0;
  const service = client({ installRetirement(id, handler) { controls.set(id, handler); return () => { controls.delete(id); }; },
   async invoke(channel, payload) {
    if (channel === channels.open) {
     assert.ok(payload && typeof payload === 'object'); const id = Reflect.get(payload, 'openId') as string, retire = controls.get(id); assert.ok(retire);
     return main.open(owner, payload, { close: () => retire('retire') });
    }
    const actual = await main.dispatch(channel, owner, payload);
    if (channel === channels.rawInput) {
     assert.ok(payload && typeof payload === 'object'); const packet: unknown = Reflect.get(payload, 'payload'); assert.ok(packet && typeof packet === 'object'); const operation = Reflect.get(packet, 'operation');
     if (operation === 'finish' && armed) { armed = false; entered.release(); await release.promise; }
     if (operation === 'close') closes++;
    }
    return actual;
   } });
  let storage: Readonly<Storage> | undefined, work: Promise<unknown> | undefined, failed = false, primary: unknown;
  try {
   storage = await service.open({ name: 'Captured native input', signal: f.signal }, { close: async () => undefined }); assert.ok(storage.components.rawImport);
   const first = new AbortController(), replacement = new AbortController(), reason = Symbol('late replacement cancellation');
   const options = { signal: first.signal }; let delivered = 0;
   work = f.track(storage.components.rawImport.withFrame({ body: new Blob([f.bytes]), contentSha256: hash(f.bytes), profile: 'canonical' }, view => {
    delivered++; assert.equal(view.decoder.engine, 'lightscaper-libraw-native'); assert.deepEqual(view.input, { byteLength: f.bytes.byteLength, contentSha256: hash(f.bytes) });
    assert.equal(hash(new Uint8Array(view.frame.pixels.buffer)), view.contentSha256); return 'original signal';
   }, options)); void work.catch(() => undefined);
   await f.reached(entered.promise, work); replacement.abort(reason); options.signal = replacement.signal; release.release();
   assert.deepEqual(await work, { outcome: 'native', value: 'original signal' });
   assert.equal(delivered, 1); assert.equal(first.signal.aborted, false); assert.equal(closes, 1); assert.equal(f.state.starts, 1); assert.equal(f.activeChildren(), 0);
  } catch (error) { failed = true; primary = error; }
  release.release(); await Promise.allSettled([work]); const results = await Promise.allSettled([storage?.close(), main.closeAll()]);
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
  try { await scopes.close(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Native input options fixture actual owners did not retire.', { cause: errors[0] });
  if (failed) throw primary;
 });
});
