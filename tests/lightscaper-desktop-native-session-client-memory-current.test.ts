/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls } from '../src/lightscaper/desktop-photo-library-session-client-calls-current-v1.ts';
import { copyDesktopPhotoBytesCurrentV1 as copy } from '../src/lightscaper/desktop-photo-library-session-transfer-client-current-v1.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { nativeSessionClientFixtureCurrentV1 as fixture, runtimeShaCurrentV1 as sha, remainsPending } from './helpers/lightscaper-desktop-native-session-client-integration-fixture-current.ts';

void test('Rejected native chunk checks length before allocation and never calls borrowed species', () => {
 let species = 0;
 class Borrowed extends Uint8Array { static get [Symbol.species]() { species++; return Uint8Array; } }
 const bytes = new Borrowed([3, 9]); assert.throws(() => copy(bytes, 1), RangeError); assert.equal(species, 0);
 const accepted = copy(bytes, 2); try { assert.equal(Object.getPrototypeOf(accepted), Uint8Array.prototype); assert.equal(sha(accepted), sha(Uint8Array.of(3, 9))); assert.equal(species, 0); } finally { accepted.fill(0); }
});

for (const kind of ['lut-put', 'lut-file', 'cache'] as const) void test(`Actual ${kind} keeps complete declared body debt through held native upload opening and retirement`, { timeout: 15_000 }, async context => {
 const actual = Calls.prototype.reserve; let liveBytes = 0;
 Calls.prototype.reserve = function(this: Calls, byteLength: number) {
  const release = Reflect.apply(actual, this, [byteLength]) as () => void; liveBytes += byteLength; let live = true;
  return () => { release(); if (live) { live = false; liveBytes -= byteLength; } };
 };
 try { await fixture(context, async f => {
  const session = await f.open(); await session.readPage(); const entered = f.gate(), release = f.gate(); let held = false;
  const expected = kind === 'cache' ? 4 : f.resource.lut.bytes.byteLength;
  f.hooks.reply = async (channel, payload) => { const op = operation(payload); if (!held && channel.endsWith(':upload') && op === (kind === 'cache' ? 'cache-begin' : kind === 'lut-put' ? 'resource-begin' : 'resource-file-begin')) { held = true; entered.release(); await release.promise; } };
  let work: Promise<unknown>;
  if (kind === 'cache') {
   const original = f.photos[2]!.original, body = Uint8Array.of(3, 5, 7, 9);
   const identity = { schemaVersion: 1, kind: PHOTO_PREVIEW_CACHE_PROFILE_V1.kind, key: `${PHOTO_PREVIEW_CACHE_PROFILE_V1.keyPrefix}bounded-client-proof`, sourceId: original.storageKey,
    originalSha256: original.contentSha256!, originalByteLength: original.byteLength, recipeId: 'bounded-client-proof', recipeVersion: 1, byteLength: body.byteLength, metadata: '{}' };
   work = f.components.media.createBinaryDerivativeCache(PHOTO_PREVIEW_CACHE_PROFILE_V1).store(identity, new Blob([body]), sha(body), context.signal);
  } else { const lut = await f.components.resources.cubeLutResources(); work = kind === 'lut-put' ? lut.put(f.resource.lut.reference, f.resource.lut.bytes) : lut.importFile(new File([f.resource.lut.bytes], 'Actual.cube')); }
  void work.catch(() => undefined);
  try { await f.reached(entered.promise, work); assert.equal(await remainsPending(work), true); assert.ok(liveBytes >= expected, 'Held actual native upload must retain its complete body-byte debt.'); }
  finally { release.release(); await work; }
  assert.equal(liveBytes, 0);
 }); } finally { Calls.prototype.reserve = actual; }
});

for (const committed of [false, true]) void test(`Actual Settings ${committed ? 'true COMMIT ACK survives' : 'false nonpublication refuses'} a stop after Main reply but before local delivery`, { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const session = await f.open(); await session.readPage(); const settings = f.components.settings.settingsRepository, key = photoImportIntentKeyV1(f.selected.catalogId);
  const intent = { schemaVersion: 1, kind: 'photo-import', catalogId: f.selected.catalogId, importId: 'held-settings-result' } as const;
  assert.equal(await settings.putIfAbsent(key, intent), true); const entered = f.gate(), release = f.gate(); let held = false;
  const target = committed ? 'delete-if-current' : 'put-if-absent';
  f.hooks.reply = async (channel, payload) => { if (!held && channel.endsWith(':settings') && operation(payload) === target) { held = true; entered.release(); await release.promise; } };
  const work = committed ? settings.deleteIfCurrent(key, intent) : settings.putIfAbsent(key, intent); void work.catch(() => undefined); let closing: Promise<void> | undefined;
  try { await f.reached(entered.promise, work); closing = session.close(); assert.equal(await remainsPending(closing), true); release.release(); if (committed) assert.equal(await work, true); else await assert.rejects(work); await closing; }
  finally { release.release(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
 });
});
function operation(value: unknown): unknown { if (!value || typeof value !== 'object') return undefined; const p: unknown = Reflect.get(value, 'payload'); return p && typeof p === 'object' ? Reflect.get(p, 'operation') as unknown : undefined; }
