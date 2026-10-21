/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { selfTestPhotoNativeCurrentV1 as selfTest, photoNativeSelfTestRetirementIsUnprovedCurrentV1 as unproved } from '../scripts/lib/lightscaper-photo-native-selftest-current-v1.ts';
import { photoNativePathsCurrentV1 as paths, type PhotoNativeFileCurrentV1 } from '../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';

const OPTIONS = { skip: process.platform !== 'linux', timeout: 15_000 } as const;
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const PASS = 'PHOTO_ISOLATION_CANARY_V1 PASS\n';
// Actual pinned Node children exercise the public producer self-test and real
// pipes/owner joins. They do not qualify native Windows or OS isolation.
async function fixture(context: TestContext, body: string, work: (f: {
 marker: string; release: string; stopped: string; start(signal?: AbortSignal): Promise<unknown>;
}) => Promise<void>): Promise<void> {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'photo-canary-diagnostic-'))), root = join(base, 'stage'), canaryRoot = join(base, 'canary');
 const marker = join(base, 'entered.json'), release = join(base, 'release.json'), stopped = join(base, 'stopped.json');
 const controller = new AbortController(); let operation: Promise<unknown> | undefined;
 const names = paths('linux-x64'), files: PhotoNativeFileCurrentV1[] = [];
 const protocol = (magic: string): string => `
let pending=Buffer.alloc(0);
process.stdin.on('data', part=>{ pending=Buffer.concat([pending,part]); while(pending.length>=16){
 const length=pending.readUInt32BE(12); if(pending.length<16+length)return;
 const frame=pending.subarray(0,16+length);pending=pending.subarray(16+length);
 if(frame[5]===10){process.exitCode=0;process.stdin.destroy();return;}
 let payload;
 if(${JSON.stringify(magic)}==='SGR1'){
  const tail=Buffer.alloc(21);tail[0]=1;tail.writeUInt16BE(64,1);tail.writeUInt16BE(4094,3);tail[5]=4;tail[6]=4;
  tail.writeUInt32BE(1048576,7);tail.writeUInt32BE(262144,11);tail.writeUInt16BE(64,15);tail.writeUInt32BE(65536,17);
  payload=Buffer.concat([frame.subarray(16,48),tail]);
 }else{
  const text=value=>Buffer.concat([Buffer.from([Buffer.byteLength(value)]),Buffer.from(value)]);
  const version=Buffer.from([0,1]),tail=Buffer.alloc(13);tail[0]=1;tail.writeUInt32BE(64*1024*1024,1);tail.writeUInt32BE(256*1024*1024,5);tail.writeUInt32BE(1048576,9);
  payload=Buffer.concat([frame.subarray(16,48),text('lightscaper-libraw-native'),version,text('0.22.2'),tail]);
 }
 const out=Buffer.alloc(16+payload.length);frame.copy(out,0,0,16);out[5]|=128;out.writeUInt32BE(payload.length,12);out.set(payload,16);process.stdout.write(out);
}});
`;
 try {
  await mkdir(root); await mkdir(canaryRoot);
  const launcher = `#!${process.execPath}\nconst fs=require('node:fs');fs.writeSync(3,${JSON.stringify('M5_NATIVE_ISOLATION_ENFORCED_V1\n')});fs.closeSync(3);new Function('require',fs.readFileSync(7,'utf8'))(require);\n`;
  const sources = new Map<string, string>([[names.filesystem, `#!${process.execPath}\n${protocol('SGR1')}`], [names.launcher, launcher], [names.raw, protocol('SRR1')], [names.profile, 'fixture profile'], [names.broker, 'fixture broker']]);
  for (const [name, source] of sources) { const bytes = Buffer.from(source); await mkdir(dirname(join(root, name)), { recursive: true }); await writeFile(join(root, name), bytes, { mode: 0o700 }); files.push({ path: name, byteLength: bytes.length, sha256: hash(bytes) }); }
  const canary = Buffer.from(`const fs=require('node:fs');const marker=${JSON.stringify(marker)},release=${JSON.stringify(release)},stopped=${JSON.stringify(stopped)};process.stdin.once('data',input=>{${body}\n});\n`);
  const canaryPin = { path: 'bin/private-canary', byteLength: canary.length, sha256: hash(canary) };
  await mkdir(join(canaryRoot, 'bin')); await writeFile(join(canaryRoot, canaryPin.path), canary, { mode: 0o700 });
  await work({ marker, release, stopped, start(signal) {
   assert.equal(operation, undefined); operation = selfTest(root, 'linux-x64', files, canaryRoot, canaryPin, AbortSignal.any([context.signal, controller.signal, ...(signal ? [signal] : [])]));
   void operation.catch(() => undefined); return operation;
  } });
 } finally {
  await writeFile(release, '{}'); controller.abort(new Error('Actual owned canary fixture teardown.'));
  if (operation) await Promise.allSettled([operation]); await rm(base, { recursive: true });
 }
}
async function entered(path: string, operation: Promise<unknown>): Promise<{ pid: number }> {
 const cancelled = new AbortController();
 const polling = (async () => { for (let n = 0; n < 1000; n++) {
  try { return JSON.parse(await readFile(path, 'utf8')) as { pid: number }; } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  await delay(5, undefined, { signal: cancelled.signal });
 } throw new Error('Actual canary barrier not reached.'); })();
 try { return await Promise.race([polling, operation.then(() => { throw new Error('Self-test completed before canary barrier.'); }, (error: unknown) => { throw error; })]); }
 finally { cancelled.abort(); await Promise.allSettled([polling]); }
}

void test('actual joined canary refusal exposes bounded trusted stage and stdout hash without binary or private stderr', OPTIONS, async context => fixture(context, `
fs.writeSync(1,Buffer.from([0,255,13,10,1]));fs.writeSync(2,${JSON.stringify('PHOTO_ISOLATION_CANARY_V1 FAIL stage=module-path code=87\r\nPRIVATE_PATH_SECRET\n')});
fs.writeFileSync(marker,JSON.stringify({pid:process.pid}));const timer=setInterval(()=>{if(fs.existsSync(release)){clearInterval(timer);process.exitCode=2;}},5);
`, async f => {
 const operation = f.start(); let settled = false; void operation.then(() => { settled = true; }, () => { settled = true; });
 await entered(f.marker, operation); await delay(20); assert.equal(settled, false); await writeFile(f.release, '{}');
 await assert.rejects(operation, (error: unknown) => { assert.ok(error instanceof Error);
  assert.match(error.message, /exit=2, signal=none, connected=false, stdoutByteLength=5/u);
  assert.ok(error.message.includes(hash(Buffer.from([0,255,13,10,1])))); assert.match(error.message, /diagnostic=module-path code=87/u);
  assert.doesNotMatch(error.message, /PRIVATE_PATH_SECRET/u); return true;
 });
}));

void test('actual failed denial marker retains separate socket and connect errors with Windows CRLF', OPTIONS, async context => fixture(context, `
fs.writeSync(2,${JSON.stringify('PHOTO_ISOLATION_CANARY_V1 FAIL stage=denials fileDenied=1 fileError=5 networkDenied=0 socketError=10022 networkError=10038 childDenied=1 childError=5\r\n')});process.exitCode=2;
`, async f => { await assert.rejects(f.start(), /diagnostic=denials fileDenied=1 fileError=5 networkDenied=0 socketError=10022 networkError=10038 childDenied=1 childError=5/u); }));

for (const [name, stderr] of [
 ['overflow', 'é'.repeat(2040) + 'PHOTO_ISOLATION_CANARY_V1 FAIL stage=module-path code=87\n'],
 ['duplicate', 'PHOTO_ISOLATION_CANARY_V1 FAIL stage=module-path code=87\nPHOTO_ISOLATION_CANARY_V1 FAIL stage=module-path code=87\n'],
 ['unknown-stage', 'PHOTO_ISOLATION_CANARY_V1 FAIL stage=caller-owned code=87\n'],
 ['oversized-code', 'PHOTO_ISOLATION_CANARY_V1 FAIL stage=module-path code=4294967296\n'],
] as const) void test(`actual ${name} stderr cannot authenticate a trusted canary marker`, OPTIONS, async context => fixture(context, `fs.writeSync(2,${JSON.stringify(stderr)});process.exitCode=2;`, async f => {
 await assert.rejects(f.start(), (error: unknown) => { assert.ok(error instanceof Error); assert.match(error.message, /exit=2, signal=none/u); assert.doesNotMatch(error.message, /diagnostic=/u); if (name === 'overflow') assert.match(error.message, /4096-byte capture bound/u); return true; });
}));

void test('stdout overflow remains failure and requests the prepared owner stop before actual child join', OPTIONS, async context => fixture(context, `
process.on('SIGTERM',()=>{fs.writeFileSync(stopped,JSON.stringify({pid:process.pid}));process.exit(0);});
fs.writeSync(1,Buffer.alloc(1025,7));setInterval(()=>{},1000);
`, async f => {
 await assert.rejects(f.start(), /stdoutByteLength=1025/u); const stopped = JSON.parse(await readFile(f.stopped, 'utf8')) as { pid: number }; assert.ok(Number.isSafeInteger(stopped.pid) && stopped.pid > 0);
}));

void test('exact original PASS remains accepted with its original isolation check digest', OPTIONS, async context => fixture(context, `fs.writeSync(1,${JSON.stringify(PASS)});`, async f => {
 const result = await f.start(); assert.ok(Array.isArray(result)); const row: unknown = result.at(-1); assert.ok(typeof row === 'object' && row !== null && 'id' in row && row.id === 'raw-isolation');
}));

void test('actual signal-ended canary preserves a null exit and real signal in failure details', OPTIONS, async context => fixture(context, `process.kill(process.pid,'SIGTERM');`, async f => { await assert.rejects(f.start(), /exit=null, signal=SIGTERM/u); }));

void test('opaque cancellation identity is retained after actual canary owner join', OPTIONS, async context => fixture(context, `fs.writeFileSync(marker,JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`, async f => {
 const controller = new AbortController(); let traps = 0; const reason = new Proxy({}, { get() { traps++; throw new Error('Do not inspect opaque cancellation.'); } });
 const operation = f.start(controller.signal); await entered(f.marker, operation); controller.abort(reason);
 const result = await operation.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
 assert.equal(result.ok, false); assert.equal(!result.ok && Object.is(result.error, reason), true); assert.equal(traps, 0);
}));

void test('actual independent group-retirement failure remains aggregated and unproved', OPTIONS, async context => fixture(context, `fs.writeFileSync(marker,JSON.stringify({pid:process.pid}));const timer=setInterval(()=>{if(fs.existsSync(release)){clearInterval(timer);process.exitCode=2;}},5);`, async f => {
 const operation = f.start(), actual = await entered(f.marker, operation), kill = process.kill.bind(process), failure = new Error('Actual retirement report fault after real group stop.');
 context.mock.method(process, 'kill', (pid: number, signal?: string | number): true => {
  if (pid !== -actual.pid) return kill(pid, signal);
  try { kill(pid, signal); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
  throw failure;
 });
 await writeFile(f.release, '{}');
 await assert.rejects(operation, (error: unknown) => { assert.ok(error instanceof AggregateError); assert.equal(unproved(error), true); assert.match(error.message, /actual independent owner retirement failed/u); return true; });
}));
