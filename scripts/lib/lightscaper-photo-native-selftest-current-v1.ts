/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkNativeFilesystemSignal as check } from '../../desktop/lightscaper-native-photo-granted-filesystem-signal-current-v1.ts';
import { preparePhotoNativeChildCurrentV1 as prepare, photoNativePreparedRetirementIsUnprovedCurrentV1 as childUnproved } from '../../desktop/lightscaper-native-photo-prepared-child-current-v1.ts';
import { NativeFilesystemProcessCurrentV1 as Filesystem } from '../../desktop/lightscaper-native-photo-granted-filesystem-process-current-v1.ts';
import { LightscaperNativePhotoRawProcessCurrentV1 as Raw } from '../../desktop/lightscaper-native-photo-raw-process-current-v1.ts';
import { photoNativeArtifactRetirementIsUnprovedCurrentV1 as artifactUnproved, copyPhotoNativePinnedFileCurrentV1 as copy, photoNativeInventoryCurrentV1 as inventory } from '../../desktop/lightscaper-native-photo-artifact-files-current-v1.ts';
import { photoNativePathsCurrentV1, type PhotoNativeFileCurrentV1, type PhotoNativeTargetCurrentV1 } from '../../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
const UNPROVED = new WeakSet<object>();
export function photoNativeSelfTestRetirementIsUnprovedCurrentV1(value: unknown): boolean { return typeof value === 'object' && value !== null && UNPROVED.has(value); }
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
async function joined<T>(work: () => Promise<T>, retirements: readonly (() => Promise<unknown>)[]): Promise<T> {
 let failed = false, primary: unknown, result!: T;
 try { result = await work(); } catch (error) { failed = true; primary = error; }
 const cleanup: unknown[] = [];
 for (const retire of retirements) try { await retire(); } catch (error) { cleanup.push(error); }
 if (cleanup.length) { const error = new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Photo self-test and actual independent owner retirement failed.'); if ([...(failed ? [primary] : []), ...cleanup].some(value => childUnproved(value) || artifactUnproved(value))) UNPROVED.add(error); throw error; }
 if (failed) throw primary; return result;
}
const CANARY_PREFIX = 'PHOTO_ISOLATION_CANARY_V1 FAIL stage=';
const CANARY_STAGES = new Set(['binary-stdio', 'header-read', 'path-length', 'path-read', 'utf16-length', 'winsock-startup', 'module-path', 'stdout-write', 'stdout-flush']);
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
async function isolationCanary(prepared: Awaited<ReturnType<typeof prepare>>, packet: Buffer, connected: () => boolean, signal?: AbortSignal): Promise<Buffer> {
 const child = prepared.start(), output: Buffer[] = [], diagnostic = Buffer.alloc(4096), stdoutHash = createHash('sha256');
 let length = 0, used = 0, overflow = false, stdoutOverflow = false, code: number | null = null, signaled: NodeJS.Signals | null = null;
 let receipt = Buffer.alloc(0), stdoutSha256 = '', trusted: string | undefined, rejectRetirement!: (error: unknown) => void;
 const retirementFailed = new Promise<never>((_resolve, reject) => { rejectRetirement = reject; }); void retirementFailed.catch(() => undefined);
 const stdout = (bytes: Buffer): void => {
  length += bytes.byteLength; stdoutHash.update(bytes);
  if (length <= 1024) output.push(Buffer.from(bytes));
  else if (!stdoutOverflow) { stdoutOverflow = true; void prepared.close().catch(rejectRetirement); }
 };
 const stderr = (bytes: Buffer): void => {
  const count = Math.min(bytes.byteLength, diagnostic.byteLength - used); bytes.copy(diagnostic, used, 0, count); used += count;
  if (count !== bytes.byteLength) overflow = true;
 };
 const closed = new Promise<void>(resolve => { child.once('close', (value, reason) => {
  code = value; signaled = reason; stdoutSha256 = stdoutHash.digest('hex'); receipt = Buffer.concat(output);
  trusted = overflow ? undefined : canaryDiagnostic(diagnostic.subarray(0, used));
  diagnostic.fill(0); for (const bytes of output) bytes.fill(0); output.length = 0;
  child.stdout.off('data', stdout); child.stderr.off('data', stderr); resolve();
 }); });
 child.stdout.on('data', stdout); child.stderr.on('data', stderr);
 try {
  child.stdin.end(packet); await Promise.race([closed, retirementFailed]); await prepared.close();
  check(signal); const actualConnected = connected();
  if (code !== 0 || signaled !== null || actualConnected || stdoutOverflow || !receipt.equals(Buffer.from('PHOTO_ISOLATION_CANARY_V1 PASS\n'))) {
   throw new Error(`Actual Photo RAW OS-isolation canary failed. Actual joined canary outcome: exit=${String(code)}, signal=${signaled ?? 'none'}, connected=${String(actualConnected)}, stdoutByteLength=${String(length)}, stdoutSha256=${stdoutSha256}.`
    + (overflow ? ' Canary stderr exceeded its 4096-byte capture bound; no diagnostic stage was admitted.' : trusted ? ` diagnostic=${trusted}.` : ' No trusted canary diagnostic marker was admitted.'));
  }
  return receipt;
 } catch (error) { receipt.fill(0); throw error; }
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
 const secret = join(canaryRoot, 'ungranted-private-canary'); await writeFile(secret, 'private ungranted canary\n', { flag: 'wx', mode: 0o600 });
 const sockets = new Set<import('node:net').Socket>(); let connected = false, listening = false;
 const server = createServer(socket => { connected = true; sockets.add(socket); socket.once('close', () => { sockets.delete(socket); }); socket.destroy(); });
 let prepared: Awaited<ReturnType<typeof prepare>> | undefined;
 await joined(async () => {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { listening = true; resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Actual isolation canary listener has no owned address.');
  prepared = await prepare(sandbox, target, canaryFiles, 'raw-engine', signal, () => undefined);
  const native = Buffer.from(secret, target.startsWith('win-') ? 'utf16le' : 'utf8'), header = Buffer.alloc(6); header.writeUInt32LE(native.length); header.writeUInt16BE(address.port, 4);
  const receipt = await isolationCanary(prepared, Buffer.concat([header, native]), () => connected, signal);
  try { await record('raw-isolation', { schemaVersion: 1, target, fileDenied: true, networkDenied: true, childDenied: true, actualStdoutSha256: hash(receipt), actualCanarySha256: canaryPin.sha256, actualChildJoined: true }); }
  finally { receipt.fill(0); }
 }, [async () => prepared?.close(), async () => { for (const socket of sockets) socket.destroy(); if (listening) await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(); }); }); }]);
 await inventory(root); return Object.freeze(outputs);
}
