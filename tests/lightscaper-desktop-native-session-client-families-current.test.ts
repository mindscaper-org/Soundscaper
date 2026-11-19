/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { nativeSessionClientFixtureCurrentV1 as fixture, runtimeShaCurrentV1 as sha } from './helpers/lightscaper-desktop-native-session-client-integration-fixture-current.ts';

void test('Native client streams genuine Blob/host metadata and explicit writers with exact ACKs through actual Main/FS/SQLite', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const session = await f.open(); await session.readPage(); const media = f.components.media;
  const bytes = new Uint8Array(2 * 1_048_576 + 37); bytes.fill(43); const body = new File([bytes], 'Actual streamed.bin', { type: 'application/octet-stream', lastModified: 123 });
  try {
   const metadata = { name: 'Captured name', custom: { undecided: undefined, text: '\ud800' }, note: new Blob([Uint8Array.of(1, 7, 9)]) };
   const writing = media.writeAsset('protocol-streamed-asset', body, metadata, { signal: context.signal }); metadata.name = 'Later mutation';
   const receipt = await writing; assert.equal(receipt.name, 'Captured name'); assert.equal(receipt.sha256, sha(bytes)); assert.equal(receipt.size, bytes.byteLength);
   assert.ok(receipt.note instanceof Blob); assert.equal(receipt.note.size, 3);
   const reloaded = await media.getAssetMetadata('protocol-streamed-asset'); assert.ok(reloaded); assert.equal(reloaded.sha256, receipt.sha256); assert.ok(reloaded.note instanceof Blob);
   const writes = f.sent.filter(row => row.channel.endsWith(':upload') && row.payload && typeof row.payload === 'object' && 'payload' in row.payload)
    .map(row => Reflect.get(row.payload as object, 'payload') as unknown).filter(value => value && typeof value === 'object' && Reflect.get(value, 'operation') === 'write');
   assert.ok(writes.length >= 3); for (const value of writes) { const chunk: unknown = Reflect.get(value as object, 'bytes'); assert.ok(chunk instanceof Uint8Array); assert.ok(chunk.byteLength <= 1_048_576); }
   const explicit = await media.beginAssetWrite('protocol-explicit-asset', { name: 'Explicit' }, { expectedBytes: 3, expectedSha256: sha(Uint8Array.of(7, 8, 9)), signal: context.signal });
   assert.equal(explicit.maximumChunkBytes, 1_048_576); await explicit.write(Uint8Array.of(7, 8, 9)); assert.equal(explicit.bytesWritten, 3);
   const committed = explicit.commit(); assert.equal(explicit.commit(), committed); assert.equal((await committed).sha256, sha(Uint8Array.of(7, 8, 9))); await explicit.abort();
   await media.deleteAsset('protocol-streamed-asset'); await media.deleteAsset('protocol-explicit-asset'); assert.equal(await media.getAssetMetadata('protocol-streamed-asset'), null);
  } finally { bytes.fill(0); }
 });
});

void test('Native client carries both complete resource families and actual LUT file import without early callback retirement', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const session = await f.open(); await session.readPage(); const resources = f.components.resources;
  const lut = await resources.cubeLutResources(), brush = await resources.maskRasterResources();
  assert.equal((await lut.put(f.resource.lut.reference, f.resource.lut.bytes)).created, false);
  assert.equal((await lut.importFile(new File([f.resource.lut.bytes], 'Actual.cube', { type: 'text/plain' }), { signal: context.signal })).reference.sha256, f.resource.lut.reference.sha256);
  for (const prepared of f.resource.brushes) {
   assert.equal((await brush.put(prepared.reference, prepared.bytes)).created, false);
   await brush.source.withBytes(prepared.reference, bytes => { assert.equal(sha(bytes), sha(prepared.bytes)); });
  }
  await lut.verifyPhoto(f.photos[0]!); await brush.verifyPhoto(f.photos[0]!);
  await lut.verifyReferencesV1([f.resource.lut.reference]); await brush.verifyReferencesV1(f.resource.brushes.map(value => value.reference));
 });
});

void test('Native client exclusive keeps local symbol/reason identity while actual child SQL calls run and native archive verifies only after done', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const session = await f.open(); await session.readPage(); const catalog = f.components.catalog;
  const marker = Symbol('local callback result');
  // Actual selected lease.exclusive is reached by this public import recovery:
  // directly exercise the installed service's complete Storage callback too.
  const controls = [...f.controls.values()]; assert.equal(controls.length, 1);
  const capture = await catalog.captureSmartCollectionArchiveV1(f.selected.catalogId, { signal: context.signal });
  const iterator = capture.definitions[Symbol.asyncIterator](); assert.equal((await iterator.next()).done, true); await capture.verify();
  const tail = f.sent.filter(row => row.channel.endsWith(':archive')); assert.equal(tail.length, 3);
  // Symbol stays local to the true callback; it is never a wire payload.
  const before = f.sent.length; const returned = await f.exclusive(f.selected.catalogId, async () => { assert.ok(await catalog.loadPhoto(f.selected.catalogId, f.photos[0]!.id)); return marker; });
  assert.equal(returned, marker); assert.ok(f.sent.length >= before + 3);
  const reason = new Proxy(Object.create(null) as object, { get() { throw new Error('Opaque callback reason reflected.'); }, ownKeys() { throw new Error('Opaque callback reason reflected.'); } });
  let caught = false; try { await f.exclusive(f.selected.catalogId, async () => { throw reason; }); } catch (error) { caught = true; assert.equal(error, reason); } assert.equal(caught, true);
 });
});

void test('Native client preserves selected settings presence/raw CAS and refuses all data before borrowed reflection after stop', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const session = await f.open(); await session.readPage(); const repository = f.components.settings.settingsRepository;
  const key = photoImportIntentKeyV1(f.selected.catalogId), intent = { schemaVersion: 1, kind: 'photo-import', catalogId: f.selected.catalogId, importId: 'protocol-test-import' } as const;
  assert.deepEqual(await repository.readEntry(key), { present: false }); assert.equal(await repository.putIfAbsent(key, intent), true);
  assert.equal(await repository.replaceIfCurrent(key, { ...intent, importId: 'foreign' }, intent), false);
  assert.equal(await repository.deleteIfCurrent(key, intent), true); assert.deepEqual(await repository.readEntry(key), { present: false });
  let reflected = 0; const poison = new Proxy({}, { get() { reflected++; throw new Error('Closed input reflected.'); }, ownKeys() { reflected++; throw new Error('Closed input reflected.'); } });
  const closing = session.close(); await assert.rejects(f.components.media.deleteAsset('unused', poison));
  await assert.rejects(f.components.catalog.readSummaryPage(f.selected.catalogId, poison)); assert.equal(reflected, 0); await closing;
 });
});
