/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { installLightscaperManagedSmokeNativeObserverCurrentV1 as install } from '../desktop/lightscaper-managed-smoke-native-custody-current-v1.ts';
import { LightscaperManagedSmokeMailboxCurrentV1 as Mailbox } from '../desktop/lightscaper-managed-smoke-mailbox-current-v1.ts';
import { readLightscaperManagedSmokeOptionsCurrentV1 as options } from '../scripts/lib/lightscaper-desktop-managed-smoke-options-current-v1.ts';
import { nativeSessionLeaseFixtureCurrentV1 as fixture, sessionLeaseShaCurrentV1 as sha } from './helpers/lightscaper-native-session-lease-integration-fixture-current.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths, lightscaperNativePhotoOriginalBodyPathCurrentV1 as bodyPath } from '../desktop/lightscaper-native-original-index-current-v1.ts';

const nonce = 'a'.repeat(32);
void test('Managed native smoke captures actual issued lease, complete Photo/body/custody and genuine bounded mailbox delivery', { timeout: 15_000 }, async context => {
 const observer = install(), mailbox = new Mailbox(nonce), cancel = (): void => { mailbox.retire(); }; context.signal.addEventListener('abort', cancel, { once: true });
 try { await fixture(context, async f => {
  const files = f.photos.map(photo => ({ name: photo.metadata.fileName, mimeType: photo.original.mimeType!, base64: Buffer.from(f.bytes).toString('base64'), byteLength: f.bytes.byteLength, sha256: sha(f.bytes) }));
  const ids = f.photos.map(photo => photo.id), held = mailbox.request(ids); void held.catch(() => undefined); const request = mailbox.take(); assert.ok(request);
  assert.deepEqual(request.photoIds, ids); assert.equal(request.id, 1); await assert.rejects(mailbox.request(ids), /pending/iu);
  const report = await observer.read(ids, files); mailbox.deliver(request.id, report); const received = await held;
  assert.equal(received.namespace, null); assert.equal(received.photos.length, 2); assert.equal(received.fingerprint.length, 64);
  assert.ok(received.photos.every(photo => photo.storage === 'native-photo-original' && photo.sha256 === sha(f.bytes) && photo.byteLength === f.bytes.byteLength));
  assert.equal((received.root as { id: string }).id, f.selected.catalogId); assert.equal((await observer.read(ids, files)).fingerprint, received.fingerprint);
  mailbox.retire(); await assert.rejects(mailbox.request(ids));
 }); } finally { mailbox.retire(); context.signal.removeEventListener('abort', cancel); await observer.close(); }
});
void test('Managed native observer refuses genuine corrupt native body and mismatched fixture without browser storage fallback', { timeout: 15_000 }, async context => {
 const observer = install();
 try { await fixture(context, async f => {
  const files = f.photos.map(photo => ({ name: photo.metadata.fileName, mimeType: photo.original.mimeType!, base64: Buffer.from(f.bytes).toString('base64'), byteLength: f.bytes.byteLength, sha256: sha(f.bytes) })), ids = f.photos.map(photo => photo.id);
  await assert.rejects(observer.read(ids, files.map(file => ({ ...file, sha256: '0'.repeat(64) }))));
  const corrupted = f.bytes.slice(); corrupted[corrupted.length - 1] = corrupted.at(-1)! ^ 1;
  try { await writeFile(bodyPath(paths(f.directory), files[0]!.sha256), corrupted); await assert.rejects(observer.read(ids, files)); }
  finally { corrupted.fill(0); }
 }); } finally { await observer.close(); }
});
void test('Missing actual Main lease refuses before reading borrowed checkpoint input; closed observer never grants capture', async () => {
 const observer = install(); let traps = 0; const ids = new Proxy([] as string[], { get() { traps++; throw new Error('No actual selected lease.'); } });
 try { await assert.rejects(observer.read(ids, [])); assert.equal(traps, 0); }
 finally { await observer.close(); }
 await assert.rejects(observer.read(ids, [])); assert.equal(traps, 0);
});
void test('Packaged managed backend selection is explicit and preserves existing complete Web qualification', () => {
 const base = ['--executable', '/owned/app', '--runtime-root', '/owned/runtime', '--output-root', '/owned/output'];
 assert.equal(options(base, 'linux').backend, 'web');
 assert.equal(options([...base, '--backend', 'native'], 'linux').backend, 'native');
 assert.equal(options([...base, '--backend', 'web'], 'linux').backend, 'web');
 for (const suffix of [['--backend', 'other'], ['--backend', 'native', '--backend', 'web']]) assert.throws(() => options([...base, ...suffix], 'linux'));
});
