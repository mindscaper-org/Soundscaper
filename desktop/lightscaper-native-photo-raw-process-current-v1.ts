/* SPDX-License-Identifier: AGPL-3.0-only */
import { ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
const ON = EventEmitter.prototype.on, ONCE = EventEmitter.prototype.once, OFF = EventEmitter.prototype.removeListener;
const RESUME = Readable.prototype.resume;
const WRITE = Writable.prototype.write, END = Writable.prototype.end, KILL = ChildProcess.prototype.kill;
const MAXIMUM = 1024 * 1024, CONTROL = 4096;
const UNRETURNED = new Set<object>();
type Pending = { id: number; opcode: number; resolve(value: Buffer): void; reject(error: unknown): void };
type Exit = Readonly<{ code: number | null; signal: NodeJS.Signals | null }>;

/** A single real child, a single outstanding exchange, bounded framing and
 * actual close+all stdio retirement. Killing or a timer never resolves Close. */
export class LightscaperNativePhotoRawProcessCurrentV1 {
 readonly #child: ChildProcessWithoutNullStreams;
 readonly #closed: Promise<Exit>; readonly #streams: readonly Promise<void>[];
 readonly #cleanup: (error: unknown) => void; readonly #listeners: Array<readonly [EventEmitter, string, (...args: never[]) => void]> = [];
 readonly #writes = new Set<Promise<void>>(); readonly #cleanupErrors: unknown[] = [];
 #pending: Pending | undefined; #buffer = Buffer.alloc(0); #used = 0; #id = 0; #exit: Exit | undefined;
 #failed = false; #failure: unknown; #retiring: Promise<Exit> | undefined; #stderr = 0;
 constructor(start: () => ChildProcessWithoutNullStreams, cleanup: (error: unknown) => void) {
  this.#cleanup = cleanup;
  const child = start();
  if (!(child instanceof ChildProcess)) throw new TypeError('Native RAW trusted start returned no actual child.');
  this.#child = child;
  try {
  if (!child.stdin || !child.stdout || !child.stderr) throw new TypeError('Native RAW trusted start returned no actual piped child.');
  this.#closed = new Promise<Exit>(resolve => {
   Reflect.apply(ONCE, child, ['close', (code: number | null, signal: NodeJS.Signals | null) => {
    const exit = Object.freeze({ code, signal }); this.#exit = exit;
    if (this.#pending) { const pending = this.#pending; this.#pending = undefined; pending.reject(this.#failed ? this.#failure : new Error('Native RAW process exited before its response.')); }
    resolve(exit);
   }]);
  });
  this.#streams = [child.stdin, child.stdout, child.stderr].map(stream => stream.closed ? Promise.resolve() : new Promise<void>(resolve => { Reflect.apply(ONCE, stream, ['close', resolve]); }));
  this.#listen(child, 'error', (error: Error) => this.#fail(error));
  this.#listen(child.stdin, 'error', (error: Error) => this.#fail(error));
  this.#listen(child.stdout, 'error', (error: Error) => this.#fail(error));
  this.#listen(child.stderr, 'error', (error: Error) => this.#fail(error));
  this.#listen(child.stdout, 'data', (part: Buffer) => this.#receive(part));
  this.#listen(child.stderr, 'data', (part: Buffer) => { this.#stderr += part.byteLength; if (this.#stderr > 8192) this.#fail(new RangeError('Native RAW stderr exceeded its diagnostic bound.')); });
  if (child.exitCode !== null || child.signalCode !== null) throw new Error('Native RAW trusted start must return a fresh live child.');
  // EventEmitter.on does not run Readable.on's data-flow activation. Start
  // both actual pipes only after every bounded owner listener is installed.
  Reflect.apply(RESUME, child.stdout, []); Reflect.apply(RESUME, child.stderr, []);
  } catch (primary) {
   // A real returned child must not vanish with a failed constructor. The
   // trusted producer contract was violated; keep this genuine owner strongly.
   UNRETURNED.add(this); this.#recordCleanup(primary);
   try { Reflect.apply(ON, child, ['error', () => undefined]); Reflect.apply(KILL, child, ['SIGKILL']); } catch (cleanup) { this.#recordCleanup(cleanup); }
   throw primary;
  }
 }
 #listen<Args extends unknown[]>(emitter: EventEmitter, name: string, callback: (...args: Args) => void): void {
  this.#listeners.push([emitter, name, callback as unknown as (...args: never[]) => void]); Reflect.apply(ON, emitter, [name, callback]);
 }
 async request(opcode: number, payload: Buffer): Promise<Buffer> {
  if (this.#retiring || this.#exit || this.#failed) throw this.#failed ? this.#failure : new Error('Native RAW process is retiring.');
  if (this.#pending) throw new Error('Native RAW accepts one physical exchange.');
  if (payload.byteLength > (opcode === 3 ? MAXIMUM + 8 : CONTROL) || this.#id === 0xffffffff) throw new RangeError('Native RAW request exceeds its framing capacity.');
  if (opcode === 5 && (payload.byteLength !== 12 || payload.readUInt32BE(8) > MAXIMUM)) throw new RangeError('Native RAW read packet is malformed.');
  this.#buffer = Buffer.alloc(16 + (opcode === 5 ? Math.max(CONTROL, payload.readUInt32BE(8)) : CONTROL)); this.#used = 0;
  const id = ++this.#id;
  const response = new Promise<Buffer>((resolve, reject) => { this.#pending = { id, opcode: opcode | 0x80, resolve, reject }; });
  // Rejection is observed immediately even if native close beats a write ACK.
  void response.catch(() => undefined);
  const header = Buffer.alloc(16); header.write('SRR1', 0, 'ascii'); header[4] = 1; header[5] = opcode;
  header.writeUInt32BE(id, 8); header.writeUInt32BE(payload.byteLength, 12); const packet = Buffer.concat([header, payload]); header.fill(0);
  const written = new Promise<void>((resolve, reject) => {
   try { Reflect.apply(WRITE, this.#child.stdin, [packet, (error?: Error | null) => { if (error) reject(error); else resolve(); }]); }
   catch (error) { reject(error); }
  });
  this.#writes.add(written); void written.then(() => { this.#writes.delete(written); }, (error: unknown) => { this.#writes.delete(written); this.#fail(error); });
  try {
   const results = await Promise.allSettled([written, response] as const);
   const write = results[0], reply = results[1];
   if (write.status === 'rejected') { this.#fail(write.reason); if (reply.status === 'fulfilled') reply.value.fill(0); throw write.reason; }
   if (reply.status === 'rejected') throw reply.reason;
   return reply.value;
  } finally { packet.fill(0); }
 }
 #receive(part: Buffer): void {
  try {
   if (this.#failed) return;
   if (!this.#pending || part.byteLength > this.#buffer.byteLength - this.#used) throw new RangeError('Native RAW unsolicited output or framing overflow.');
   part.copy(this.#buffer, this.#used); this.#used += part.byteLength; const next = this.#buffer;
   if (this.#used < 16) return;
   const pending = this.#pending;
   if (next.subarray(0, 4).toString('ascii') !== 'SRR1' || next[4] !== 1 || next.readUInt16BE(6) !== 0 || next.readUInt32BE(8) !== pending.id)
    throw new TypeError('Native RAW response identity is invalid.');
   const opcode = next[5]!, length = next.readUInt32BE(12);
   if (length > (pending.opcode === 0x85 && opcode !== 0xff ? MAXIMUM : CONTROL)) throw new RangeError('Native RAW response length exceeds its exact operation.');
   if (this.#used < 16 + length) return;
   if (this.#used !== 16 + length) throw new TypeError('Native RAW returned an extra unsolicited response.');
   const result = Buffer.from(next.subarray(16, 16 + length)); next.fill(0); this.#buffer = Buffer.alloc(0); this.#used = 0; this.#pending = undefined;
   if (opcode === 0xff) { try { pending.reject(nativeError(result)); } catch (error) { pending.reject(error); this.#fail(error); } finally { result.fill(0); } }
   else if (opcode !== pending.opcode) { result.fill(0); pending.reject(new TypeError('Native RAW returned the wrong response opcode.')); }
   else pending.resolve(result);
  } catch (error) { this.#fail(error); }
 }
 #fail(error: unknown): void {
  if (!this.#failed) { this.#failed = true; this.#failure = error; }
  const pending = this.#pending; this.#pending = undefined; pending?.reject(this.#failure);
  void this.retire(true).catch(() => undefined);
 }
 #terminate(): void {
  if (this.#exit) return;
  try { Reflect.apply(KILL, this.#child, ['SIGKILL']); } catch (error) { this.#recordCleanup(error); }
 }
 #recordCleanup(error: unknown): void {
  this.#cleanupErrors.push(error); try { this.#cleanup(error); } catch (secondary) { this.#cleanupErrors.push(secondary); }
 }
 retire(force: boolean): Promise<Exit> {
  if (this.#retiring) { if (force) this.#terminate(); return this.#retiring; }
  let resolve!: (exit: Exit) => void, reject!: (error: unknown) => void;
  this.#retiring = new Promise<Exit>((accept, refuse) => { resolve = accept; reject = refuse; });
  if (force) this.#terminate();
  try { Reflect.apply(END, this.#child.stdin, []); } catch (error) { this.#recordCleanup(error); this.#terminate(); }
  const timer = setTimeout(() => this.#terminate(), 2000); timer.unref();
  void this.#closed.then(async exit => {
   clearTimeout(timer); await Promise.all(this.#streams); await Promise.allSettled([...this.#writes]);
   this.#buffer.fill(0); this.#buffer = Buffer.alloc(0); this.#used = 0;
   for (const [emitter, name, listener] of this.#listeners) { try { Reflect.apply(OFF, emitter, [name, listener]); } catch (error) { this.#recordCleanup(error); } }
   this.#listeners.length = 0;
   if (this.#cleanupErrors.length) throw new AggregateError(this.#cleanupErrors, 'Native RAW actual child/stdio retirement is unproved.');
   return exit;
  }).then(resolve, reject);
  return this.#retiring;
 }
}
function nativeError(value: Buffer): Error {
 if (value.byteLength < 6 || value[3] !== 0 || value.readUInt16BE(4) > 512 || value.byteLength !== 6 + value.readUInt16BE(4)) throw new TypeError('Native RAW error frame is invalid.');
 const text = value.subarray(6); if (text.some(byte => byte < 32 || byte > 126)) throw new TypeError('Native RAW error diagnostic is not bounded ASCII.');
 return new Error(`Native RAW refused phase ${value[2]!}, code ${value.readUInt16BE(0)}: ${text.toString('ascii')}`);
}
