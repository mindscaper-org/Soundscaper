/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { selfTestPhotoNativeCurrentV1 as selfTest } from '../scripts/lib/lightscaper-photo-native-selftest-current-v1.ts';
import { photoNativePathsCurrentV1 as paths, type PhotoNativeFileCurrentV1 } from '../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';

const OPTIONS = { skip: process.platform !== 'linux', timeout: 15_000 } as const;
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
// Actual pinned Node children exercise the public producer self-test and real
// pipes/owner joins. They do not qualify native Windows or OS isolation.
async function fixture(context: TestContext, body: string, work: (f: {
 marker: string; release: string; stopped: string; start(signal?: AbortSignal): Promise<unknown>; receipt(): Promise<unknown>;
}) => Promise<void>, controlMode: 'normal' | 'no-connection' | 'bad-marker' | 'accepted-policy' = 'normal'): Promise<void> {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'photo-canary-diagnostic-'))), root = join(base, 'stage'), canaryRoot = join(base, 'canary');
 const marker = join(base, 'entered.json'), release = join(base, 'release.json'), stopped = join(base, 'stopped.json');
 context.mock.property(process, 'env', { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:SystemRoot|SystemDrive|LOCALAPPDATA)$/iu.test(key))), SystemRoot: 'C:\\Windows', SystemDrive: 'C:', LOCALAPPDATA: base });
 const controller = new AbortController(); let operation: Promise<unknown> | undefined;
 const names = paths('win-x64'), files: PhotoNativeFileCurrentV1[] = [];
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
  const version=Buffer.from([0,1]),tail=Buffer.alloc(13);tail[0]=4;tail.writeUInt32BE(64*1024*1024,1);tail.writeUInt32BE(256*1024*1024,5);tail.writeUInt32BE(1048576,9);
  payload=Buffer.concat([frame.subarray(16,48),text('lightscaper-libraw-native'),version,text('0.22.2'),tail]);
 }
 const out=Buffer.alloc(16+payload.length);frame.copy(out,0,0,16);out[5]|=128;out.writeUInt32BE(payload.length,12);out.set(payload,16);process.stdout.write(out);
}});
`;
 try {
  await mkdir(root); await mkdir(canaryRoot);
  const launcher = `#!${process.execPath}\nconst fs=require('node:fs');fs.writeSync(3,${JSON.stringify('M5_NATIVE_ISOLATION_ENFORCED_V1\n')});fs.closeSync(3);new (require('node:net').Socket)({fd:8,readable:true,writable:false}).once('data',()=>process.exit(0));new Function('require',fs.readFileSync(7,'utf8').split(String.fromCharCode(10)).filter((line,index)=>index!==0||!line.startsWith('#!')).join(String.fromCharCode(10)))(require);\n`;
  const sources = new Map<string, string>([[names.filesystem, `#!${process.execPath}\n${protocol('SGR1')}`], [names.launcher, launcher], [names.raw, protocol('SRR1')], [names.profile, 'fixture profile'], [names.broker, 'fixture broker']]);
  for (const [name, source] of sources) { const bytes = Buffer.from(source); await mkdir(dirname(join(root, name)), { recursive: true }); await writeFile(join(root, name), bytes, { mode: 0o700 }); files.push({ path: name, byteLength: bytes.length, sha256: hash(bytes) }); }
  const canary = Buffer.from(`#!${process.execPath}\nconst fs=require('node:fs');const mode=${JSON.stringify(controlMode)},marker=${JSON.stringify(marker)},release=${JSON.stringify(release)},stopped=${JSON.stringify(stopped)};
if(process.argv[2]==='--network-policy-control'){
 if(mode==='accepted-policy')process.exit(0);
 fs.writeSync(2,${JSON.stringify('PHOTO_ISOLATION_CANARY_V1 FAIL stage=network-token-app code=0\r\n')});process.exit(2);
}else if(process.argv[2]==='--network-positive-control'){
 if(mode==='no-connection'){fs.writeSync(1,${JSON.stringify('PHOTO_ISOLATION_CANARY_V2 NETWORK_CONTROL_PASS\n')});process.exit(0);}
 const socket=require('node:net').connect({host:'127.0.0.1',port:Number(process.argv[3])},()=>{
  fs.writeSync(1,mode==='bad-marker'?'untrusted':${JSON.stringify('PHOTO_ISOLATION_CANARY_V2 NETWORK_CONTROL_PASS\n')});socket.destroy();
 });socket.once('error',()=>process.exit(3));socket.once('close',()=>process.exit(0));
}else process.stdin.once('data',input=>{${body}\n});\n`);
  const canaryPin = { path: 'bin/private-canary', byteLength: canary.length, sha256: hash(canary) };
  await mkdir(join(canaryRoot, 'bin')); await writeFile(join(canaryRoot, canaryPin.path), canary, { mode: 0o700 });
  await work({ marker, release, stopped, async receipt() { return JSON.parse(await readFile(join(root, 'checks/raw-isolation.json'), 'utf8')) as unknown; }, start(signal) {
   assert.equal(operation, undefined); operation = selfTest(root, 'win-x64', files, canaryRoot, canaryPin, AbortSignal.any([context.signal, controller.signal, ...(signal ? [signal] : [])]));
   void operation.catch(() => undefined); return operation;
  } });
 } finally {
  await writeFile(release, '{}'); controller.abort(new Error('Actual owned canary fixture teardown.'));
  if (operation) await Promise.allSettled([operation]); await rm(base, { recursive: true });
 }
}

function record(value: unknown): Record<string, unknown> { assert.ok(typeof value === 'object' && value !== null); return value as Record<string, unknown>; }
const POLICY = `fs.writeSync(1,${JSON.stringify('PHOTO_ISOLATION_CANARY_V3 POLICY_PASS type=2 lpacAccess=2\n')});process.exit(0);`;
void test('Windows policy receipt requires actual separate TCP positive control and labels policy rather than a restricted TCP syscall', OPTIONS, async context => fixture(context, POLICY, async f => {
 await f.start(); const receipt = record(await f.receipt()), evidence = record(receipt.networkEvidence), positive = record(evidence.positiveControl);
 assert.equal('networkDenied' in receipt, false); assert.equal(evidence.kind, 'windows-token-network-policy-v2'); assert.equal(evidence.classificationTarget, '192.0.2.1'); assert.equal(evidence.policyType, 2);
 assert.deepEqual(evidence.actualCurrentToken, { appContainer: true, capabilities: 0 });
 assert.deepEqual(evidence.actualLpacAccessCheck, { kind: 'actual-current-token-aap-exclusion-access-check-v1', allApplicationPackages: { requestedAccess: 1, apiSucceeded: true, accessStatus: false, grantedAccess: 0 }, allRestrictedApplicationPackages: { requestedAccess: 2, apiSucceeded: true, accessStatus: true, grantedAccess: 2 } });
 assert.equal(evidence.actualLoopbackExemptionAbsent, true); assert.equal(evidence.pointInTimePolicyEvidence, true);
 assert.equal(positive.kind, 'uncontained-tcp-positive-control'); assert.equal(positive.actualChildJoined, true); assert.equal(positive.appContainer, false);
 assert.equal(positive.winsockStartupStatus, 0); assert.equal(positive.connectionEstablishedStatus, 0); assert.equal(positive.actualLoopbackConnectionObserved, true); assert.equal(positive.nonAppContainerPolicyRefusalObserved, true);
 assert.equal(positive.canarySha256, receipt.actualCanarySha256); assert.equal(receipt.fileDenied, true); assert.equal(receipt.childDenied, true);
}));
void test('old private V1 PASS cannot masquerade as Windows policy proof', OPTIONS, async context => fixture(context, `fs.writeSync(1,${JSON.stringify('PHOTO_ISOLATION_CANARY_V1 PASS\n')});process.exit(0);`, async f => { await assert.rejects(f.start(), /OS-isolation canary failed/u); }));
void test('generic Winsock startup10107 remains a failed canary and is never policy proof', OPTIONS, async context => fixture(context, `fs.writeSync(2,${JSON.stringify('PHOTO_ISOLATION_CANARY_V1 FAIL stage=winsock-startup code=10107\r\n')});process.exit(2);`, async f => { await assert.rejects(f.start(), /diagnostic=winsock-startup code=10107/u); }));
void test('NONE policy type cannot pass the exact Windows policy receipt grammar', OPTIONS, async context => fixture(context, `fs.writeSync(1,${JSON.stringify('PHOTO_ISOLATION_CANARY_V3 POLICY_PASS type=0 lpacAccess=2\n')});process.exit(0);`, async f => { await assert.rejects(f.start(), /OS-isolation canary failed/u); }));
void test('uncontained marker without actual owned loopback connection cannot qualify control', OPTIONS, async context => fixture(context, POLICY, async f => { await assert.rejects(f.start(), /did not reach its actual owned loopback listener/u); }, 'no-connection'));
void test('uncontained actual connection without exact private control marker cannot qualify control', OPTIONS, async context => fixture(context, POLICY, async f => { await assert.rejects(f.start(), /uncontained private canary network control differs/u); }, 'bad-marker'));
void test('uncontained current-token policy guard must actually refuse before the positive control', OPTIONS, async context => fixture(context, POLICY, async f => { await assert.rejects(f.start(), /unexpectedly accepted LPAC network policy/u); }, 'accepted-policy'));

void test('prior V2 policy receipt cannot substitute for actual AAP-exclusion AccessCheck evidence', OPTIONS, async context => fixture(context, `fs.writeSync(1,${JSON.stringify('PHOTO_ISOLATION_CANARY_V2 POLICY_PASS type=2\n')});process.exit(0);`, async f => { await assert.rejects(f.start(), /OS-isolation canary failed/u); }));
for (const mask of [0, 1, 3]) void test(`Windows AccessCheck proof refuses granted mask ${String(mask)} instead of exact restricted-only bit2`, OPTIONS, async context => fixture(context, `fs.writeSync(1,${JSON.stringify(`PHOTO_ISOLATION_CANARY_V3 POLICY_PASS type=2 lpacAccess=${String(mask)}\n`)});process.exit(0);`, async f => { await assert.rejects(f.start(), /OS-isolation canary failed/u); }));
void test('actual AccessCheck API error87 stays a trusted diagnostic failure rather than token evidence', OPTIONS, async context => fixture(context, `fs.writeSync(2,${JSON.stringify('PHOTO_ISOLATION_CANARY_V1 FAIL stage=network-token-access-api code=87\r\n')});process.exit(2);`, async f => { await assert.rejects(f.start(), /diagnostic=network-token-access-api code=87/u); }));
