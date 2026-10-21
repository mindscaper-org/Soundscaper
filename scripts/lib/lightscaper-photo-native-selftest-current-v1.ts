/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPhotoNativeToolCurrentV1 as tool } from './lightscaper-photo-native-tool-current-v1.ts';
import { spawnNativeRawStdioChildCurrentV1 as spawnControl } from '../../desktop/native-child-raw-stdio-current-v1.ts';
import { checkNativeFilesystemSignal as check, linkNativeFilesystemSignal as link } from '../../desktop/lightscaper-native-photo-granted-filesystem-signal-current-v1.ts';
import { preparePhotoNativeChildCurrentV1 as prepare, photoNativePreparedRetirementIsUnprovedCurrentV1 as childUnproved } from '../../desktop/lightscaper-native-photo-prepared-child-current-v1.ts';
import { NativeFilesystemProcessCurrentV1 as Filesystem } from '../../desktop/lightscaper-native-photo-granted-filesystem-process-current-v1.ts';
import { LightscaperNativePhotoRawProcessCurrentV1 as Raw } from '../../desktop/lightscaper-native-photo-raw-process-current-v1.ts';
import { photoNativeArtifactRetirementIsUnprovedCurrentV1 as artifactUnproved, openPhotoNativePinnedFileCurrentV1 as authenticate, copyPhotoNativePinnedFileCurrentV1 as copy, photoNativeInventoryCurrentV1 as inventory } from '../../desktop/lightscaper-native-photo-artifact-files-current-v1.ts';
import { photoNativePathsCurrentV1, type PhotoNativeFileCurrentV1, type PhotoNativeTargetCurrentV1 } from '../../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
const UNPROVED = new WeakSet<object>();
export function photoNativeSelfTestRetirementIsUnprovedCurrentV1(value: unknown): boolean { return typeof value === 'object' && value !== null && UNPROVED.has(value); }
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
async function joined<T>(work: () => Promise<T>, retirements: readonly (() => Promise<unknown>)[]): Promise<T> {
 let failed = false, primary: unknown, result!: T;
 try { result = await work(); } catch (error) { failed = true; primary = error; }
 const cleanup: unknown[] = [];
 for (const retire of retirements) try { await retire(); } catch (error) { cleanup.push(error); }
 if (cleanup.length) { const error = new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Photo self-test and actual independent owner retirement failed.'); if ([...(failed ? [primary] : []), ...cleanup].some(value => childUnproved(value) || artifactUnproved(value) || (typeof value === 'object' && value !== null && UNPROVED.has(value)))) UNPROVED.add(error); throw error; }
 if (failed) throw primary; return result;
}
const CANARY_PREFIX = 'PHOTO_ISOLATION_CANARY_V1 FAIL stage=';
const CANARY_STAGES = new Set(['arguments', 'binary-stdio', 'child-denial', 'file-denial', 'header-read', 'host-ack', 'module-path', 'network-config-contained', 'network-config-roundtrip', 'network-config-sid', 'network-config-token-api', 'network-config-token-open', 'network-control-connect', 'network-control-contained', 'network-control-port', 'network-control-socket-close', 'network-control-token-api', 'network-control-token-close', 'network-control-token-open', 'network-control-winsock-close', 'network-policy-cleanup', 'network-policy-config', 'network-policy-config-sid', 'network-policy-config-size', 'network-policy-diagnose', 'network-policy-library', 'network-policy-loopback-exempt', 'network-policy-procedure', 'network-policy-type', 'network-token-access-api', 'network-token-access-mask', 'network-token-access-privilege-size', 'network-token-app', 'network-token-app-api', 'network-token-cap-api', 'network-token-cap-size', 'network-token-capabilities', 'network-token-duplicate', 'network-token-lpac', 'network-token-lpac-api', 'network-token-open', 'network-token-security-descriptor', 'network-token-sid', 'network-token-sid-api', 'network-token-sid-size', 'network-token-sid-string', 'network-token-sid-text', 'path-length', 'path-read', 'stdout-flush', 'stdout-write', 'utf16-length', 'winsock-startup']);
function canaryDiagnostic(bytes: Buffer): string | undefined {
 const text = bytes.toString('utf8'), first = text.indexOf(CANARY_PREFIX);
 if (first < 0 || text.indexOf(CANARY_PREFIX, first + 1) !== -1 || (first !== 0 && text[first - 1] !== '\n')) return;
 const end = text.indexOf('\n', first); if (end < 0) return;
 const line = text.slice(first, end).replace(/\r$/u, '');
 const early = /^PHOTO_ISOLATION_CANARY_V1 FAIL stage=([a-z-]+) code=(0|[1-9][0-9]{0,9})$/u.exec(line);
 if (early && CANARY_STAGES.has(early[1]!) && Number(early[2]) <= 0xffffffff) return `${early[1]} code=${early[2]}`;
 const denials = /^PHOTO_ISOLATION_CANARY_V1 FAIL stage=denials fileDenied=([01]) fileError=(0|[1-9][0-9]{0,9}) networkDenied=([01]) socketError=(0|[1-9][0-9]{0,9}) networkError=(0|[1-9][0-9]{0,9}) childDenied=([01]) childError=(0|[1-9][0-9]{0,9})$/u.exec(line);
 if (denials && denials.slice(1).every(value => Number(value) <= 0xffffffff)) return line.slice('PHOTO_ISOLATION_CANARY_V1 FAIL stage='.length);
 return undefined;
}
type HostConfiguration = Readonly<{ kind: 'same-binary-host-global-loopback-config-v1'; appContainerSid: string; actualApiStatus: 0; actualChildJoined: true; actualLoopbackExemptionAbsent: true; canarySha256: string; actualStdoutSha256: string }>;
function canonicalProfileSid(sid: string): boolean {
 return sid.length <= 195 && /^S-1-15-2(?:-(?:0|[1-9][0-9]{0,9})){7}$/u.test(sid) && sid.split('-').slice(4).every(value => Number(value) <= 0xffffffff);
}
async function hostConfiguration(root: string, pin: PhotoNativeFileCurrentV1, sid: string, signal: AbortSignal): Promise<HostConfiguration> {
 check(signal); if (!canonicalProfileSid(sid)) throw new Error('Actual host configuration SID is not canonical.');
 const executable = await authenticate(root, pin); let owner: ReturnType<typeof spawnControl> | undefined, detach = (): void => {};
 let timer: ReturnType<typeof setTimeout> | undefined; const output = Buffer.alloc(1024), diagnostic = Buffer.alloc(4096);
 return joined(async () => {
  check(signal); owner = spawnControl(join(root, pin.path), ['--network-config-control', sid], { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, env: { ...process.env, NODE_V8_COVERAGE: undefined } });
  const actual = owner, child = actual.child; let used = 0, errors = 0, failed = false, primary: unknown, code: number | null = null, signaled: NodeJS.Signals | null = null;
  const refuse = (reason: unknown): void => { if (!failed) { failed = true; primary = reason; } void actual.close().catch(() => undefined); };
  child.once('error', refuse); child.once('close', (value, outcomeSignal) => { code = value; signaled = outcomeSignal; });
  child.stdout.on('data', (bytes: Buffer) => { const count = Math.min(bytes.length, output.length - used); bytes.copy(output, used, 0, count); used += count; if (count !== bytes.length) refuse(new RangeError('Actual host configuration stdout exceeded its bound.')); });
  child.stderr.on('data', (bytes: Buffer) => { const count = Math.min(bytes.length, diagnostic.length - errors); bytes.copy(diagnostic, errors, 0, count); errors += count; if (count !== bytes.length) refuse(new RangeError('Actual host configuration stderr exceeded its bound.')); });
  detach = link(signal, () => { try { check(signal); } catch (reason) { refuse(reason); } });
  timer = setTimeout(() => { refuse(new Error('Actual host configuration deadline expired.')); }, 5000);
  child.stdin.end(); if (signal.aborted) { try { check(signal); } catch (reason) { refuse(reason); } }
  await actual.joined; await actual.close(); check(signal); if (failed) throw primary;
  if (code !== 0 || signaled !== null) throw new Error(`Actual host configuration failed: exit=${String(code)}, signal=${signaled ?? 'none'}, diagnostic=${canaryDiagnostic(diagnostic.subarray(0, errors)) ?? 'unavailable'}.`);
  const expected = `PHOTO_ISOLATION_CANARY_V4 CONFIG_PASS sid=${sid}\n`;
  if (!output.subarray(0, used).equals(Buffer.from(expected))) throw new Error('Actual host configuration echo differs from the live child SID.');
  return Object.freeze({ kind: 'same-binary-host-global-loopback-config-v1' as const, appContainerSid: sid, actualApiStatus: 0 as const, actualChildJoined: true as const, actualLoopbackExemptionAbsent: true as const, canarySha256: pin.sha256, actualStdoutSha256: hash(output.subarray(0, used)) });
 }, [async () => {
  if (timer) clearTimeout(timer); detach();
  try { await owner?.close(); } catch (error) { const unproved = new AggregateError([error], 'Actual private host query retirement is unproved.'); UNPROVED.add(unproved); throw unproved; }
 }, async () => { output.fill(0); diagnostic.fill(0); await executable.close(); }]);
}
async function isolationCanary(prepared: Awaited<ReturnType<typeof prepare>>, packet: Buffer, connected: () => boolean, signal?: AbortSignal,
 windowsHost?: (sid: string, signal: AbortSignal) => Promise<HostConfiguration>): Promise<Readonly<{ receipt: Buffer; hostConfiguration: HostConfiguration | null; appContainerSid: string | null }>> {
 const child = prepared.start(), output: Buffer[] = [], diagnostic = Buffer.alloc(4096), stdoutHash = createHash('sha256'), handshake = new AbortController();
 let length = 0, used = 0, overflow = false, stdoutOverflow = false, code: number | null = null, signaled: NodeJS.Signals | null = null;
 let receipt = Buffer.alloc(0), stdoutSha256 = '', trusted: string | undefined, rejectRetirement!: (error: unknown) => void;
 let readySid: string | null = null, readyBytes = 0, acknowledged = false, failed = false, primary: unknown, acceptReady!: (sid: string | undefined) => void;
 let deadline: ReturnType<typeof setTimeout> | undefined, host: HostConfiguration | null = null;
 const ready = new Promise<string | undefined>(resolve => { acceptReady = resolve; });
 const retirementFailed = new Promise<never>((_resolve, reject) => { rejectRetirement = reject; }); void retirementFailed.catch(() => undefined);
 const refuse = (reason: unknown): void => { if (!failed) { failed = true; primary = reason; } handshake.abort(reason); acceptReady(undefined); void prepared.close().catch(rejectRetirement); };
 const arm = (): void => { if (deadline) clearTimeout(deadline); deadline = setTimeout(() => { refuse(new Error('Actual Photo RAW OS-isolation canary failed: readiness or final acknowledgement deadline expired.')); }, 5000); };
 const stdout = (bytes: Buffer): void => {
  length += bytes.byteLength; stdoutHash.update(bytes);
  if (length <= 1024) output.push(Buffer.from(bytes));
  else if (!stdoutOverflow) { stdoutOverflow = true; if (windowsHost) refuse(new RangeError('Actual Photo RAW OS-isolation canary failed: readiness exceeded its bound.')); else void prepared.close().catch(rejectRetirement); }
  if (!windowsHost || stdoutOverflow) return;
  const text = Buffer.concat(output).toString('utf8'), end = text.indexOf('\n'); if (end < 0) return;
  if (readySid === null) {
   const match = /^PHOTO_ISOLATION_CANARY_V4 SID_READY sid=(S-[0-9-]+)\n$/u.exec(text.slice(0, end + 1));
   if (!match || !canonicalProfileSid(match[1]!)) { refuse(new Error('Actual Photo RAW OS-isolation canary failed: readiness SID or grammar differs.')); return; }
   readySid = match[1]!; readyBytes = end + 1; acceptReady(readySid);
  }
  if ((!acknowledged && text.length > readyBytes) || text.slice(readyBytes).includes('SID_READY')) refuse(new Error('Actual Photo RAW OS-isolation canary failed: readiness repeated or supplied a premature final result.'));
 };
 const stderr = (bytes: Buffer): void => { const count = Math.min(bytes.byteLength, diagnostic.byteLength - used); bytes.copy(diagnostic, used, 0, count); used += count; if (count !== bytes.byteLength) overflow = true; };
 const closed = new Promise<void>(resolve => { child.once('close', (value, reason) => {
  code = value; signaled = reason; stdoutSha256 = stdoutHash.digest('hex'); receipt = Buffer.concat(output);
  trusted = overflow ? undefined : canaryDiagnostic(diagnostic.subarray(0, used)); diagnostic.fill(0); for (const bytes of output) bytes.fill(0); output.length = 0;
  child.stdout.off('data', stdout); child.stderr.off('data', stderr); acceptReady(undefined);
  if (windowsHost && readySid !== null && !acknowledged) refuse(new Error('Actual Photo RAW OS-isolation canary failed: readiness peer closed before host acknowledgement.'));
  resolve();
 }); });
 child.stdout.on('data', stdout); child.stderr.on('data', stderr);
 try {
  if (windowsHost) {
   arm(); child.stdin.write(packet); const sid = await Promise.race([ready, retirementFailed]); if (deadline) clearTimeout(deadline);
   if (sid !== undefined && !failed) {
    host = await windowsHost(sid, AbortSignal.any([handshake.signal, ...(signal ? [signal] : [])])); check(signal);
    if (failed) throw primary; if (child.exitCode !== null || child.signalCode !== null) throw new Error('Actual Photo RAW OS-isolation canary failed: readiness peer retired before acknowledgement.');
    acknowledged = true; arm(); child.stdin.end(Buffer.from([1]));
   }
  } else child.stdin.end(packet);
  await Promise.race([closed, retirementFailed]); await prepared.close(); check(signal); if (failed) throw primary;
  const actualConnected = connected(), expected = windowsHost && readySid ? `PHOTO_ISOLATION_CANARY_V4 SID_READY sid=${readySid}\nPHOTO_ISOLATION_CANARY_V4 POLICY_PASS sid=${readySid} lpacAccess=2\n` : 'PHOTO_ISOLATION_CANARY_V1 PASS\n';
  if (code !== 0 || signaled !== null || actualConnected || stdoutOverflow || !receipt.equals(Buffer.from(expected)) || (windowsHost && (!host || !acknowledged))) {
   throw new Error(`Actual Photo RAW OS-isolation canary failed. Actual joined canary outcome: exit=${String(code)}, signal=${signaled ?? 'none'}, connected=${String(actualConnected)}, stdoutByteLength=${String(length)}, stdoutSha256=${stdoutSha256}.`
    + (overflow ? ' Canary stderr exceeded its 4096-byte capture bound; no diagnostic stage was admitted.' : trusted ? ` diagnostic=${trusted}.` : ' No trusted canary diagnostic marker was admitted.'));
  }
  return Object.freeze({ receipt, hostConfiguration: host, appContainerSid: readySid });
 } catch (error) { handshake.abort(error); receipt.fill(0); throw error; }
 finally { if (deadline) clearTimeout(deadline); }
}
async function windowsNetworkControl(root: string, pin: PhotoNativeFileCurrentV1, signal?: AbortSignal) {
 const executable = await authenticate(root, pin), sockets = new Set<import('node:net').Socket>();
 let connected = false, listening = false, accepted!: () => void;
 const connection = new Promise<void>(resolve => { accepted = resolve; });
 const server = createServer(socket => { connected = true; accepted(); sockets.add(socket); socket.once('close', () => { sockets.delete(socket); }); socket.destroy(); });
 return joined(async () => {
  // Same pinned executable, real uncontained token: the policy-only mode must refuse.
  let refused = false;
  try { await tool(join(root, pin.path), ['--network-policy-control'], signal); }
  catch (error) {
   check(signal);
   if (!(error instanceof Error) || !/^Photo native tool failed \(2, null\)\nstdout \(tail\):\n\nstderr \(tail\):\nPHOTO_ISOLATION_CANARY_V1 FAIL stage=network-token-app code=0\r?\n$/u.test(error.message)) throw error;
   refused = true;
  }
  if (!refused) throw new Error('Uncontained private canary unexpectedly accepted LPAC network policy.');
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { listening = true; resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Actual positive network control listener has no owned address.');
  const stdout = await tool(join(root, pin.path), ['--network-positive-control', String(address.port)], signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([connection, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(new Error('Positive canary control did not reach its actual owned loopback listener.')); }, 2000); })]); }
  finally { if (timer) clearTimeout(timer); }
  check(signal);
  if (!connected || stdout !== 'PHOTO_ISOLATION_CANARY_V2 NETWORK_CONTROL_PASS\n') throw new Error('Actual uncontained private canary network control differs.');
  return Object.freeze({ kind: 'uncontained-tcp-positive-control' as const, canarySha256: pin.sha256, actualStdoutSha256: hash(Buffer.from(stdout)),
   actualChildJoined: true, appContainer: false, winsockStartupStatus: 0, connectionEstablishedStatus: 0, actualLoopbackConnectionObserved: true, nonAppContainerPolicyRefusalObserved: true });
 }, [async () => {
  for (const socket of sockets) socket.destroy();
  if (listening) await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(); }); });
 }, executable.close]);
}
export async function selfTestPhotoNativeCurrentV1(root: string, target: PhotoNativeTargetCurrentV1, files: readonly PhotoNativeFileCurrentV1[],
 canaryRoot: string, canaryPin: PhotoNativeFileCurrentV1, signal?: AbortSignal) {
 const outputs: Readonly<{ id: string; status: 'passed'; sha256: string }>[] = [], paths = photoNativePathsCurrentV1(target);
 async function record(id: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`); await mkdir(join(root, 'checks'), { recursive: true });
  await writeFile(join(root, 'checks', `${id}.json`), bytes, { flag: 'wx' }); outputs.push(Object.freeze({ id, status: 'passed', sha256: hash(bytes) }));
 }
 const fsPrepared = await prepare(root, target, files, 'granted-filesystem', signal, () => undefined); let fs: Filesystem | undefined;
 await joined(async () => {
  fs = new Filesystem(fsPrepared.start, () => { throw new Error('Actual FS self-test cleanup is unproved.'); }); await fs.initialize(); await fs.close();
  await record('filesystem-protocol', { schemaVersion: 1, target, protocol: 'SGR1', initialized: true, actualShutdownJoined: true, payload: files.find(file => file.path === paths.filesystem)!.sha256 });
 }, [async () => fs?.close(), fsPrepared.close]);
 const rawPrepared = await prepare(root, target, files, 'raw-engine', signal, () => undefined); let raw: Raw | undefined;
 const nonce = randomBytes(32);
 await joined(async () => {
  raw = new Raw(rawPrepared.start, () => { throw new Error('Actual RAW self-test cleanup is unproved.'); }, rawPrepared.close); const reply = await raw.request(1, nonce);
  try {
   if (reply.length < 33 || !reply.subarray(0, 32).equals(nonce)) throw new Error('Actual RAW native protocol nonce differs.');
   let offset = 32; const text = (): string => { const size = reply[offset++]!; if (!size || size > 128 || offset + size > reply.length) throw new Error('Actual RAW native handshake is malformed.'); const value = reply.subarray(offset, offset + size).toString('ascii'); offset += size; return value; };
   if (text() !== 'lightscaper-libraw-native' || reply.readUInt16BE(offset) !== 1) throw new Error('Actual RAW engine identity differs.'); offset += 2;
   if (text() !== '0.22.2' || offset + 13 !== reply.length || reply[offset] !== ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].indexOf(target) + 1
    || reply.readUInt32BE(offset + 1) !== 64 * 1024 * 1024 || reply.readUInt32BE(offset + 5) !== 256 * 1024 * 1024 || reply.readUInt32BE(offset + 9) !== 1048576) throw new Error('Actual RAW target/capacity identity differs.');
   await raw.retire(true); await rawPrepared.close(); await record('raw-protocol', { schemaVersion: 1, target, protocol: 'SRR1', actualHandshakeHex: reply.toString('hex'), actualChildJoined: true });
  } finally { reply.fill(0); }
 }, [async () => { nonce.fill(0); await raw?.retire(true); }, rawPrepared.close]);
 // This separately compiled canary is private. No qualification opcode enters
 // shipping SRR1; its substitute is never placed in the produced inventory.
 const sandbox = join(canaryRoot, 'sandbox'); await mkdir(sandbox); const canaryFiles: PhotoNativeFileCurrentV1[] = [];
 for (const file of files.filter(file => new Set<string>([paths.launcher, paths.profile, paths.broker]).has(file.path))) { await copy(root, file, join(sandbox, file.path)); canaryFiles.push(file); }
 await copy(canaryRoot, canaryPin, join(sandbox, paths.raw)); canaryFiles.push(Object.freeze({ ...canaryPin, path: paths.raw }));
 const positiveControl = target.startsWith('win-') ? await windowsNetworkControl(canaryRoot, canaryPin, signal) : null;
 const secret = join(canaryRoot, 'ungranted-private-canary'); await writeFile(secret, 'private ungranted canary\n', { flag: 'wx', mode: 0o600 });
 const sockets = new Set<import('node:net').Socket>(); let connected = false, listening = false;
 const server = createServer(socket => { connected = true; sockets.add(socket); socket.once('close', () => { sockets.delete(socket); }); socket.destroy(); });
 let prepared: Awaited<ReturnType<typeof prepare>> | undefined;
 await joined(async () => {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { listening = true; resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Actual isolation canary listener has no owned address.');
  prepared = await prepare(sandbox, target, canaryFiles, 'raw-engine', signal, () => undefined);
  const native = Buffer.from(secret, target.startsWith('win-') ? 'utf16le' : 'utf8'), header = Buffer.alloc(6); header.writeUInt32LE(native.length); header.writeUInt16BE(address.port, 4);
  const { receipt, hostConfiguration: configuration, appContainerSid } = await isolationCanary(prepared, Buffer.concat([header, native]), () => connected, signal, target.startsWith('win-') ? (sid, currentSignal) => hostConfiguration(canaryRoot, canaryPin, sid, currentSignal) : undefined);
  try { await record('raw-isolation', { schemaVersion: 1, target, fileDenied: true, ...(positiveControl ? { networkEvidence: { kind: 'windows-zero-capability-host-loopback-policy-v1', actualCurrentToken: { appContainer: true, capabilities: 0, appContainerSid }, actualLpacAccessCheck: { kind: 'actual-current-token-aap-exclusion-access-check-v1', allApplicationPackages: { requestedAccess: 1, apiSucceeded: true, accessStatus: false, grantedAccess: 0 }, allRestrictedApplicationPackages: { requestedAccess: 2, apiSucceeded: true, accessStatus: true, grantedAccess: 2 } }, actualLoopbackExemptionAbsent: true, hostConfiguration: configuration, pointInTimePolicyEvidence: true, positiveControl } } : { networkDenied: true }), childDenied: true, actualStdoutSha256: hash(receipt), actualCanarySha256: canaryPin.sha256, actualChildJoined: true }); }
  finally { receipt.fill(0); }
 }, [async () => prepared?.close(), async () => { for (const socket of sockets) socket.destroy(); if (listening) await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(); }); }); }]);
 await inventory(root); return Object.freeze(outputs);
}
