/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { preparePhotoNativeChildCurrentV1 as prepare, photoNativePreparedRetirementIsUnprovedCurrentV1 as unproved, type LightscaperNativePhotoPreparedChildCurrentV1 as Prepared } from '../desktop/lightscaper-native-photo-prepared-child-current-v1.ts';
import { photoNativePathsCurrentV1 as paths, type PhotoNativeFileCurrentV1 } from '../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';

const OPTIONS = { skip: process.platform !== 'linux', timeout: 10_000 } as const;
const TARGET = 'linux-x64' as const;
// The actual executable fixture tests Main preparation/real pipes and joins.
// It is not a native Windows, sandbox, parser or shipping-producer witness.
async function fixture(context: TestContext, body: string, work: (value: {
 root: string; marker: string; release: string; retired(): number;
 start(signal?: AbortSignal, onRetired?: () => void): Promise<Prepared>;
}) => Promise<void>): Promise<void> {
 const root = await realpath(await mkdtemp(join(tmpdir(), 'photo-native-enforcement-diagnostic-')));
 const marker = join(root, 'entered.json'), release = join(root, 'release.json'), controller = new AbortController();
 let operation: Promise<Prepared> | undefined, retired = 0;
 try {
  const names = paths(TARGET), files: PhotoNativeFileCurrentV1[] = [];
  const source = `#!${process.execPath}\nconst fs = require('node:fs');\nconst marker=${JSON.stringify(marker)}, release=${JSON.stringify(release)};\n${body}\n`;
  for (const name of [names.launcher, names.profile, names.broker, names.raw]) {
   const bytes = Buffer.from(name === names.launcher ? source : 'pinned unused fixture artifact\n');
   await mkdir(dirname(join(root, name)), { recursive: true }); await writeFile(join(root, name), bytes, { mode: 0o700 });
   files.push({ path: name, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await work({ root, marker, release, retired: () => retired, start(signal, onRetired) {
   assert.equal(operation, undefined, 'one genuine preparation per fixture');
   operation = prepare(root, TARGET, files, 'raw-engine', AbortSignal.any([context.signal, controller.signal, ...(signal ? [signal] : [])]), () => { retired++; onRetired?.(); });
   void operation.catch(() => undefined); return operation;
  } });
 } finally {
  controller.abort(new Error('Owned actual diagnostic fixture teardown.'));
  await writeFile(release, '{}\n');
  if (operation) { const result = await Promise.allSettled([operation]); if (result[0]!.status === 'fulfilled') await result[0]!.value.close(); }
  await rm(root, { recursive: true });
 }
}
async function entered(path: string, operation: Promise<unknown>): Promise<void> {
 const stopped = new AbortController();
 const marker = async (): Promise<void> => {
  for (let attempt = 0; attempt < 300; attempt++) {
   try { await readFile(path); return; } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
   await delay(5, undefined, { signal: stopped.signal });
  }
  throw new Error('Actual fixture never reached its owned barrier.');
 };
 const polling = marker();
 try { await Promise.race([polling, operation.then(() => { throw new Error('Preparation settled before its actual barrier.'); }, error => { throw error; })]); }
 finally { stopped.abort(); await Promise.allSettled([polling]); }
}

void test('actual pre-enforcement refusal retains trusted stage and real exit only after actual child retirement', OPTIONS, async context => fixture(context, `
process.on('SIGTERM', () => {});
fs.writeSync(1, Buffer.from('UNTRUSTED_STDOUT_SECRET'));
fs.writeSync(2, 'M5_NATIVE_ISOLATION_FAILURE_V1 windows create-process 5\\nPRIVATE_STDERR_SECRET\\n');
fs.closeSync(3); fs.writeFileSync(marker, '{}');
const timer = setInterval(() => { if (fs.existsSync(release)) { clearInterval(timer); process.exitCode = 125; } }, 5);
`, async f => {
 const operation = f.start(); let settled = false; void operation.then(() => { settled = true; }, () => { settled = true; });
 await entered(f.marker, operation); await delay(20); assert.equal(settled, false); assert.equal(f.retired(), 0);
 await writeFile(f.release, '{}');
 await assert.rejects(operation, (error: unknown) => {
  assert.ok(error instanceof Error); assert.match(error.message, /Native launcher outcome: exit=125, signal=none; diagnostic=windows create-process 5/u);
  assert.doesNotMatch(error.message, /PRIVATE_STDERR_SECRET|UNTRUSTED_STDOUT_SECRET/u);
  assert.ok(error.cause instanceof Error); assert.match(error.cause.message, /handshake ended early/u); return true;
 });
 assert.equal(f.retired(), 1);
}));

void test('actual overflowing UTF-8 diagnostic pipe cannot authenticate a truncated stage or number', OPTIONS, async context => fixture(context, `
fs.writeSync(2, 'é'.repeat(2035) + '\\nM5_NATIVE_ISOLATION_FAILURE_V1 windows create-process 1234567890\\nSECRET_AFTER_BOUND\\n');
process.exitCode = 125;
`, async f => {
 await assert.rejects(f.start(), (error: unknown) => {
  assert.ok(error instanceof Error); assert.match(error.message, /exit=125, signal=none/u);
  assert.match(error.message, /4096-byte capture bound; no diagnostic stage was admitted/u);
  assert.doesNotMatch(error.message, /diagnostic=|SECRET_AFTER_BOUND|é/u); return true;
 });
 assert.equal(f.retired(), 1);
}));

void test('actual successful enforcement leaves binary stdout and later role stderr for its genuine consumer', OPTIONS, async context => fixture(context, `
fs.writeSync(3, 'M5_NATIVE_ISOLATION_ENFORCED_V1\\n'); fs.closeSync(3);
fs.writeSync(1, Buffer.from([0,255,0,13,10]));
process.stdin.once('data', () => { fs.writeSync(2, 'M5_NATIVE_ISOLATION_FAILURE_V1 windows forged-role 9\\n'); process.exitCode=0; process.stdin.resume(); });
`, async f => {
 const prepared = await f.start(), child = prepared.start(), stdout: Buffer[] = [], stderr: Buffer[] = [];
 assert.equal(child.stdout.readableFlowing, null);
 const closed = new Promise<void>(resolve => { child.once('close', () => { resolve(); }); });
 child.stdout.on('data', (bytes: Buffer) => { stdout.push(Buffer.from(bytes)); }); child.stderr.on('data', (bytes: Buffer) => { stderr.push(Buffer.from(bytes)); });
 child.stdin.end('actual role consumer'); await closed; await prepared.close();
 assert.deepEqual(Buffer.concat(stdout), Buffer.from([0,255,0,13,10]));
 assert.equal(Buffer.concat(stderr).toString('utf8'), 'M5_NATIVE_ISOLATION_FAILURE_V1 windows forged-role 9\n');
 assert.equal(child.exitCode, 0); assert.equal(f.retired(), 1);
}));

void test('actual pre-enforcement cancellation keeps its opaque reason identity after accepted child joins', OPTIONS, async context => fixture(context, `
fs.writeSync(2, 'M5_NATIVE_ISOLATION_FAILURE_V1 windows create-process 5\\n');
fs.writeFileSync(marker, '{}'); setInterval(() => {}, 1000);
`, async f => {
 const controller = new AbortController(); let traps = 0;
 const reason = new Proxy({}, { get() { traps++; throw new Error('Cancellation reason must not be reflected.'); } });
 const operation = f.start(controller.signal); await entered(f.marker, operation); controller.abort(reason);
 const outcome = await operation.then(() => ({ status: 'fulfilled' as const }), (error: unknown) => ({ status: 'rejected' as const, error }));
 assert.equal(outcome.status, 'rejected'); assert.equal(outcome.status === 'rejected' && Object.is(outcome.error, reason), true);
 assert.equal(traps, 0); assert.equal(f.retired(), 1);
}));

void test('actual signal-ended enforcement reports null exit and its actual signal without an invented code', OPTIONS, async context => fixture(context, `
process.kill(process.pid, 'SIGTERM');
`, async f => {
 await assert.rejects(f.start(), (error: unknown) => {
  assert.ok(error instanceof Error); assert.match(error.message, /Native launcher outcome: exit=null, signal=SIGTERM/u);
  assert.doesNotMatch(error.message, /diagnostic=/u); return true;
 });
 assert.equal(f.retired(), 1);
}));

void test('actual joined child with failed capacity retirement retains its original aggregate and unproved fence', OPTIONS, async context => fixture(context, `
fs.writeSync(2, 'M5_NATIVE_ISOLATION_FAILURE_V1 windows create-process 5\\n'); process.exitCode=125;
`, async f => {
 const cleanup = Object.freeze({ actualRetirementCallbackFailure: true });
 await assert.rejects(f.start(undefined, () => { throw cleanup; }), (error: unknown) => {
  assert.ok(error instanceof AggregateError); assert.equal(unproved(error), true);
  assert.equal(error.message, 'Photo native preparation and retirement failed.');
  const [primary, retirement] = error.errors as unknown[];
  assert.ok(primary instanceof Error); assert.match(primary.message, /handshake ended early/u);
  assert.ok(retirement instanceof AggregateError); assert.equal(unproved(retirement), true);
  assert.ok(retirement.errors.includes(cleanup)); return true;
 });
 assert.equal(f.retired(), 1, 'retirement callback runs after actual child and pinned handles joined');
}));
