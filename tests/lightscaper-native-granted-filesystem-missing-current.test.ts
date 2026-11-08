/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { readLightscaperNativePhotoGrantedFilesystemMissingCurrentV1 as missing,
 lightscaperNativePhotoGrantedFilesystemRetirementIsUnprovedCurrentV1 as unproved } from '../desktop/lightscaper-native-photo-granted-filesystem-current-v1.ts';
import { NativeGrantedFilesystemError, NativeWriter, readNativeError } from '../desktop/lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
import { nativeGrantedFilesystemFixtureCurrentV1 as fixture, grantedFsPathCurrentV1 as path, GRANTED_FS_OP as op } from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';
const options = Object.freeze({ concurrency: false, timeout: 15000 });
async function refusal(work: Promise<unknown>): Promise<unknown> {
 const outcome = await work.then(() => ({ succeeded: true }), (error: unknown) => ({ error }));
 assert.ok('error' in outcome, 'The actual native operation must refuse.'); return outcome.error;
}
void test('actual missing root is positively classified only after native open and successful cleanup', options, async context => fixture(context, async f => {
 const error = await refusal(f.role.openRoot(path(join(f.directory, 'root-absent')), null));
 assert.equal(missing(error), 'root-missing'); assert.equal(unproved(error), false); assert.equal(f.count(op.rootOpen), 1);
 assert.ok(error instanceof NativeGrantedFilesystemError); assert.equal(error.code, 7); assert.equal(error.phase, op.rootOpen);
 assert.equal(error.message, `Native granted filesystem operation refused. [code=7, phase=2, nativeCode=${error.nativeCode}]`);
 const root = await f.root(); await root.close();
}));
void test('actual missing file leaf and missing native parent retain file-open context', options, async context => fixture(context, async f => {
 const root = await f.root();
 for (const components of [[path('absent.bin')], [path('absent-parent'), path('photo.bin')]]) {
  const error = await refusal(root.openFile(components)); assert.equal(missing(error), 'file-missing'); assert.equal(unproved(error), false);
  assert.ok(error instanceof NativeGrantedFilesystemError); assert.equal(error.code, 7); assert.equal(error.phase, op.fileOpen);
  assert.equal(error.message, `Native granted filesystem operation refused. [code=7, phase=4, nativeCode=${error.nativeCode}]`);
 }
 const file = await root.openFile([path('photo.bin')]); assert.equal((await file.read(0, file.byteLength)).byteLength, f.bytes.byteLength); await file.close(); await root.close();
}));
void test('actual ENOTDIR, unsafe traversal, expected-root mismatch and scan absence remain hard refusals', options, async context => fixture(context, async f => {
 const root = await f.root();
 assert.equal(missing(await refusal(root.openFile([path('photo.bin'), path('child')]))), null);
 assert.equal(missing(await refusal(f.role.openRoot(path(join(f.rootPath, 'photo.bin')), null))), null);
 assert.equal(missing(await refusal(f.role.openRoot(path(f.rootPath), { volume: 'foreign-volume', object: 'foreign-object' }))), null);
 assert.equal(missing(await refusal(root.openScan([path('absent-directory')]))), null);
 await symlink(f.outside, join(f.rootPath, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
 assert.equal(missing(await refusal(root.openFile([path('escape'), path('photo.bin')]))), null); await root.close();
}));
void test('forged error classes, decoded forged frames and opaque reasons confer no missing witness', options, () => {
 const native = 2;
 const encoded = new NativeWriter().number(7, 2).number(op.rootOpen, 1).number(native, 4).number(0, 1).number(0, 2).finish();
 let reflected = 0; const opaque = new Proxy({}, { get() { reflected++; throw Symbol('get'); }, ownKeys() { reflected++; throw Symbol('keys'); }, getPrototypeOf() { reflected++; throw Symbol('prototype'); } });
 for (const value of [new NativeGrantedFilesystemError(7, op.rootOpen, native), readNativeError(encoded),
  { code: 7, phase: op.fileOpen, nativeCode: native }, new Error('ENOENT'), Symbol('reason'), null, undefined, opaque]) assert.equal(missing(value), null);
 assert.equal(reflected, 0);
});
void test('actual held missing reply followed by opaque cancellation is never classified unavailable', options, async context => fixture(context, async f => {
 const gate = f.hold(op.rootOpen), controller = new AbortController(), reason = Symbol('cancel owns first reason');
 const work = f.track(f.role.openRoot(path(join(f.directory, 'root-absent')), null, { signal: controller.signal }));
 const outcome = work.then(() => ({ succeeded: true }), (error: unknown) => ({ error }));
 try { await gate.entered; controller.abort(reason); gate.release(); const result = await outcome; assert.ok('error' in result); assert.equal(result.error, reason); assert.equal(missing(result.error), null); }
 finally { gate.release(); await outcome; }
}));
void test('actual missing after an opened parent plus failed native close never becomes unavailable', {
 ...options, skip: process.platform !== 'linux',
}, async context => fixture(context, async f => {
 const root = await f.root(), error = await refusal(root.openFile([path('nested'), path('absent.bin')]));
 assert.equal(missing(error), null); assert.equal(unproved(error), true);
 const cleanup = await refusal(f.role.close()); f.expectCleanup(cleanup); await f.native.joined;
 assert.match(f.native.stderr(), /SCAPE_CLOSE_FAULT actual=1 replacement=1 retries=0/u);
}, 'directory'));

for (const [code, phase, nativeCode, flag] of [[7, op.next, 87, 0], [65535, 255, 4294967295, 1]] as const) {
 void test(`validated native refusal keeps exact bounded numeric diagnostics (${code}/${phase}/${nativeCode}) without path payload`, () => {
  const secret = Buffer.from('/private/owned/photo.NEF', 'ascii');
  const encoded = new NativeWriter().number(code, 2).number(phase, 1).number(nativeCode, 4).number(flag, 1)
   .number(secret.byteLength, 2).raw(secret).finish();
  const error = readNativeError(encoded);
  assert.ok(error instanceof NativeGrantedFilesystemError); assert.equal(error.name, 'NativeGrantedFilesystemError');
  assert.deepEqual([error.code, error.phase, error.nativeCode], [code, phase, nativeCode]);
  assert.equal(error.message, `Native granted filesystem operation refused. [code=${code}, phase=${phase}, nativeCode=${nativeCode}]`);
  assert.ok(error.message.length <= 128); assert.equal(error.message.includes(secret.toString('ascii')), false);
  assert.equal(unproved(error), flag === 1); assert.equal(missing(error), null, 'Numeric diagnostics never mint a real missing reply witness.');
 });
}
void test('numeric refusal diagnostics preserve malformed-frame and non-ASCII diagnostic refusals', () => {
 const encoded = new NativeWriter().number(7, 2).number(op.next, 1).number(87, 4).number(0, 1).number(0, 2).finish();
 const zeroCode = Buffer.from(encoded); zeroCode.writeUInt16BE(0, 0);
 const invalidFlag = Buffer.from(encoded); invalidFlag[7] = 2;
 const nonAscii = new NativeWriter().number(7, 2).number(op.next, 1).number(87, 4).number(0, 1).number(1, 2).raw(new Uint8Array([31])).finish();
 for (const value of [zeroCode, invalidFlag, nonAscii, Buffer.concat([encoded, Buffer.from([0])]), encoded.subarray(0, 9)]) {
  assert.throws(() => readNativeError(value));
 }
});
