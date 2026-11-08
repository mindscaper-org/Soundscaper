/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyNativeTestFixture } from '../../scripts/lib/node-native-test-fixtures.ts';
import { LightscaperNativePhotoRawCurrentV1 as Raw } from '../../desktop/lightscaper-native-photo-raw-current-v1.ts';

export type NativeRawRoleCurrentV1 = ReturnType<typeof Raw.create>;
export const rawRoleHashCurrentV1 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
type Mode = 'neutral' | 'linear-headroom' | 'highlight-recovery' | 'embedded';
type Tier = null | 'thumbnail' | 'fit-screen';
type Source = Readonly<{ byteLength: number; contentSha256: string;
 read(offset: number, length: number, options: Readonly<{ signal: AbortSignal }>): Promise<Uint8Array<ArrayBuffer>> }>;
type OwnerOptions = Parameters<typeof Raw.create>[0];
type ChildRecord = { child: ChildProcessWithoutNullStreams; closed: boolean; terminal: Promise<void> };
export interface NativeRawRoleFixtureCurrentV1 {
 readonly state: { starts: number; reads: number; alerts: number;
  onRead: undefined | ((index: number, value: Uint8Array<ArrayBuffer>) => Promise<void>) };
 readonly signal: AbortSignal;
 create(options?: Partial<OwnerOptions>): NativeRawRoleCurrentV1;
 source(options?: Readonly<{ sha256?: string; byteLength?: number }>): Source;
 gate(): Readonly<{ promise: Promise<void>; release(): void }>;
 track<Value>(work: Promise<Value>): Promise<Value>;
 request(mode?: Mode, tier?: Tier): Readonly<{ mode: Mode; tier: Tier; source: Source }>;
 activeChildren(): number;
 kill(): void;
 nativeHashRefusal(): Promise<void>;
 reached(promise: Promise<void>): Promise<void>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** All observed reads forward the actual FileHandle. Deadline/exit ownership is
 * active: release every held receipt, abort every owner, kill+join real peers,
 * join accepted work, close the real file, then remove the private fixture. */
export async function nativeRawRoleFixtureCurrentV1<Result>(context: TestContext, bytes: Uint8Array<ArrayBuffer>,
 run: (fixture: Readonly<NativeRawRoleFixtureCurrentV1>) => Promise<Result>): Promise<Result> {
 const directory = await mkdtemp(join(tmpdir(), 'lightscaper-native-raw-role-'));
 const path = join(directory, 'source.dng'), executable = join(directory, process.platform === 'win32' ? 'role.exe' : 'role');
 const scope = new AbortController(), releases = new Set<() => void>(), owners = new Set<NativeRawRoleCurrentV1>();
 const children: ChildRecord[] = [], tasks = new Set<Promise<unknown>>(), buffers = new Set<Uint8Array<ArrayBuffer>>([bytes]);
 let file: Awaited<ReturnType<typeof open>> | undefined;
 const state = { starts: 0, reads: 0, alerts: 0, onRead: undefined as undefined | ((index: number, value: Uint8Array<ArrayBuffer>) => Promise<void>) };
 const stop = () => {
  if (!scope.signal.aborted) scope.abort(context.signal.aborted ? context.signal.reason : new DOMException('Native RAW test retired.', 'AbortError'));
  for (const release of [...releases]) release();
  for (const value of children) if (!value.closed) value.child.kill('SIGKILL');
 };
 const timer = setTimeout(stop, 12_000);
 context.signal.addEventListener('abort', stop, { once: true });
 let outcome: { value: Result } | { error: unknown };
 try {
  check(context.signal);
  assert.ok(copyNativeTestFixture({ repositoryRoot: fileURLToPath(new URL('../../', import.meta.url)), kind: 'lightscaper-raw-role', outputPath: executable }),
   'Root must prepare the real SRR1 peer in the existing shared fresh native-artifact registry.');
  await writeFile(path, bytes, { flag: 'wx' }); check(context.signal); file = await open(path, 'r');
  const actualFile = file, actualRead = file.read;
  const start = (): ChildProcessWithoutNullStreams => {
   check(scope.signal); state.starts++;
   const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
   const record: ChildRecord = { child, closed: false, terminal: Promise.resolve() };
   record.terminal = new Promise<void>(resolve => { child.once('close', () => { record.closed = true; resolve(); }); });
   // Production also observes this real event. The fixture has an independent
   // rejection listener so a startup error cannot become unhandled in cleanup.
   child.on('error', () => undefined); children.push(record); return child;
  };
  const create = (options: Partial<OwnerOptions> = {}): NativeRawRoleCurrentV1 => {
   const owner = Raw.create({ start, signal: scope.signal, unretired: () => { state.alerts++; }, ...options }); owners.add(owner); return owner;
  };
  const source = (options: Readonly<{ sha256?: string; byteLength?: number }> = {}): Source => {
   const cap: Source = { byteLength: options.byteLength ?? bytes.byteLength, contentSha256: options.sha256 ?? rawRoleHashCurrentV1(bytes),
    async read(offset, length, options) {
     assert.equal(this, cap, 'Actual source reader receiver must be retained.'); check(scope.signal); check(options.signal);
     assert.ok(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length > 0 && length <= 1024 * 1024);
     const result = new Uint8Array(length); buffers.add(result);
     const read = await Reflect.apply(actualRead, actualFile, [result, 0, length, offset]) as { bytesRead: number };
     assert.equal(read.bytesRead, length, 'Actual source file must satisfy each bounded read.');
     state.reads++; if (state.onRead) await state.onRead(state.reads, result);
     check(options.signal); check(scope.signal); return result;
    },
   }; return cap;
  };
  const gate = () => {
   let accept!: () => void; const promise = new Promise<void>(resolve => { accept = resolve; });
   const release = () => { releases.delete(release); accept(); }; releases.add(release);
   if (scope.signal.aborted) release(); return Object.freeze({ promise, release });
  };
  const track = <Value>(work: Promise<Value>): Promise<Value> => {
   tasks.add(work); void work.then(() => { tasks.delete(work); }, () => { tasks.delete(work); }); return work;
  };
  const fixture = Object.freeze<NativeRawRoleFixtureCurrentV1>({ state, create, source, gate, track, signal: scope.signal,
   request: (mode: Mode = 'neutral', tier: Tier = null) => ({ mode, tier, source: source() }),
   activeChildren: () => children.filter(child => !child.closed).length,
   kill: () => { for (const child of children) if (!child.closed) child.child.kill('SIGKILL'); },
   nativeHashRefusal: () => track(nativeHashRefusal(start(), bytes)),
   reached: async (promise: Promise<void>) => { await promise; check(context.signal); check(scope.signal); },
  });
  outcome = { value: await run(fixture) };
 } catch (error) { outcome = { error }; }
 const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
 clearTimeout(timer); context.signal.removeEventListener('abort', stop); stop();
 for (const owner of owners) { try { owner.stop(); } catch (error) { failures.push(error); } }
 await Promise.allSettled([...tasks]);
 const closed = await Promise.allSettled([...owners].map(owner => owner.close()));
 for (const result of closed) if (result.status === 'rejected') failures.push(result.reason as unknown);
 await Promise.all(children.map(child => child.terminal));
 try { await file?.close(); } catch (error) { failures.push(error); }
 for (const value of buffers) value.fill(0);
 try { await rm(directory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
 if (failures.length === 1) throw failures[0];
 if (failures.length > 1) throw new AggregateError(failures, 'Native RAW fixture and actual retirement failed.');
 if ('value' in outcome) return outcome.value;
 throw new Error('Native RAW fixture has no outcome.');
}

/** Genuine peer-negative probe bypasses Main's separate digest check, proving
 * the actual native process independently refuses the wrong declared SHA. */
async function nativeHashRefusal(child: ChildProcessWithoutNullStreams, input: Uint8Array<ArrayBuffer>): Promise<void> {
 let failure: unknown, storage = Buffer.alloc(0), waiting: { resolve(value: Buffer): void; reject(error: unknown): void } | undefined, ended = false;
 const terminal = new Promise<void>(resolve => { child.once('close', () => { ended = true; waiting?.reject(new Error('Native probe exited before its framed reply.')); resolve(); }); });
 let opcode = 0, identifier = 0;
 const parse = (): Buffer | undefined => {
  if (storage.byteLength < 16) return undefined;
  assert.equal(storage.subarray(0, 4).toString('ascii'), 'SRR1'); assert.equal(storage[4], 1); assert.equal(storage.readUInt16BE(6), 0);
  const length = storage.readUInt32BE(12); assert.ok(length <= 4096, 'Negative probe never admits a large native output.');
  if (storage.byteLength < 16 + length) return undefined;
  assert.equal(storage.readUInt32BE(8), identifier); opcode = storage[5]!;
  const result = Buffer.from(storage.subarray(16, 16 + length)), rest = Buffer.from(storage.subarray(16 + length)); storage.fill(0); storage = rest; return result;
 };
 const receive = (part: Buffer): void => {
  try {
   assert.ok(storage.byteLength + part.byteLength <= 8192); const next = Buffer.concat([storage, part]); storage.fill(0); storage = next;
   if (waiting) { const result = parse(); if (result) { const pending = waiting; waiting = undefined; pending.resolve(result); } }
  } catch (error) { failure ??= error; waiting?.reject(error); waiting = undefined; child.kill('SIGKILL'); }
 };
 child.stdout.on('data', receive);
 child.stdout.on('error', error => { failure ??= error; waiting?.reject(error); child.kill('SIGKILL'); });
 child.stderr.on('data', (part: Buffer) => { if (part.byteLength > 8192) child.kill('SIGKILL'); });
 child.stdin.on('error', () => undefined);
 const exchange = async (operation: number, payload: Uint8Array): Promise<Buffer> => {
  identifier++; const header = Buffer.alloc(16); header.write('SRR1', 0, 'ascii'); header[4] = 1; header[5] = operation;
  header.writeUInt32BE(identifier, 8); header.writeUInt32BE(payload.byteLength, 12); const packet = Buffer.concat([header, payload]);
  try { await new Promise<void>((resolve, reject) => { child.stdin.write(packet, error => { if (error) reject(error); else resolve(); }); }); }
  finally { header.fill(0); packet.fill(0); }
  if (failure !== undefined) throw failure;
  const ready = parse(); if (ready) return ready;
  if (ended) throw new Error('Native probe already exited.');
  return new Promise<Buffer>((resolve, reject) => { waiting = { resolve, reject }; });
 };
 try {
  let reply = await exchange(1, new Uint8Array(32)); try { assert.equal(opcode, 0x81); } finally { reply.fill(0); }
  const begin = Buffer.alloc(44); begin[0] = 1; begin.writeBigUInt64BE(BigInt(input.byteLength), 4);
  reply = await exchange(2, begin); begin.fill(0); try { assert.equal(opcode, 0x82); } finally { reply.fill(0); }
  const data = Buffer.alloc(8 + input.byteLength); data.set(input, 8);
  reply = await exchange(3, data); data.fill(0); try { assert.equal(opcode, 0x83); } finally { reply.fill(0); }
  reply = await exchange(4, new Uint8Array()); try { assert.equal(opcode, 0xff, 'Actual native SEAL must refuse the wrong SHA before output.'); } finally { reply.fill(0); }
  child.stdin.end(); await terminal; assert.equal(child.exitCode, 2);
 } finally { child.stdin.end(); if (!ended) child.kill('SIGKILL'); await terminal; child.stdout.off('data', receive); storage.fill(0); }
}
