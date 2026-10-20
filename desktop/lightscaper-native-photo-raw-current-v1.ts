/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../src/common/editor/image-import-admission.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { linkLightscaperNativePhotoMediaSignalsCurrentV1 as link, checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { reserveLightscaperNativePhotoRawCurrentV1 as reserve, quarantineLightscaperNativePhotoRawCurrentV1 as quarantine } from './lightscaper-native-photo-raw-budget-current-v1.ts';
import { LightscaperNativePhotoRawProcessCurrentV1 as Process } from './lightscaper-native-photo-raw-process-current-v1.ts';
import { captureLightscaperNativePhotoRawRequestCurrentV1 as capture, copyLightscaperNativePhotoRawChunkCurrentV1 as copy,
 readLightscaperNativePhotoRawHeaderCurrentV1 as header, LIGHTSCAPER_NATIVE_PHOTO_RAW_CHUNK_CURRENT_V1 as CHUNK,
 LIGHTSCAPER_NATIVE_PHOTO_RAW_MODES_CURRENT_V1 as MODES, LIGHTSCAPER_NATIVE_PHOTO_RAW_TIERS_CURRENT_V1 as TIERS,
 type LightscaperNativePhotoRawDecodedCurrentV1 as Decoded, type LightscaperNativePhotoRawRequestCurrentV1 as Request } from './lightscaper-native-photo-raw-contract-current-v1.ts';
export type { LightscaperNativePhotoRawDecodedCurrentV1, LightscaperNativePhotoRawModeCurrentV1, LightscaperNativePhotoRawTierCurrentV1 } from './lightscaper-native-photo-raw-contract-current-v1.ts';
export interface LightscaperNativePhotoRawOptionsCurrentV1 {
 readonly start: () => ChildProcessWithoutNullStreams;
 readonly retire?: () => Promise<void>;
 readonly signal?: AbortSignal;
 readonly unretired?: () => void;
}
const Controller = AbortController, ABORT = Controller.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(Controller.prototype, 'signal')!.get!;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const FILL = Uint8Array.prototype.fill, SET = Uint8Array.prototype.set;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** One supervised fixed RAW job. Main-only trusted start/source closures carry
 * authority; descriptors and this byte view alone never authorize a Photo. */
export class LightscaperNativePhotoRawCurrentV1 {
 readonly #shutdown = new Controller(); readonly #cleanup = new Set<unknown>();
 #signal = Reflect.apply(SIGNAL, this.#shutdown, []) as AbortSignal;
 #retire: (() => Promise<void>) | undefined;
 #detach = (): void => undefined; #start!: () => ChildProcessWithoutNullStreams; #unretired = (): void => undefined;
 #held: { request: Readonly<Request>; consume: unknown; peer?: Process; plane?: Uint8Array<ArrayBuffer> } | undefined;
 #notified = false; #active: Promise<unknown> | undefined; #peer: Process | undefined; #stopped = false; #closing: Promise<void> | undefined;
 private constructor() {}
 static create(value: LightscaperNativePhotoRawOptionsCurrentV1): LightscaperNativePhotoRawCurrentV1 {
  const owner = new LightscaperNativePhotoRawCurrentV1();
  try {
   const signal = ownSignal(value); if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
   const selected = link(signal, owner.#signal); owner.#signal = selected.signal; owner.#detach = selected.detach;
   const input = record(value, 'native RAW owner', ['start', 'signal', 'unretired', 'retire'], ['start']);
   if ((Object.hasOwn(input, 'signal') ? field(input, 'signal', 'native RAW owner') : undefined) !== signal) throw new TypeError('Native RAW owner signal changed during capture.');
   const start = field(input, 'start', 'native RAW owner'), unretired = Object.hasOwn(input, 'unretired') ? field(input, 'unretired', 'native RAW owner') : undefined;
   const retire = Object.hasOwn(input, 'retire') ? field(input, 'retire', 'native RAW owner') : undefined;
   if (retire !== undefined && typeof retire !== 'function' || typeof start !== 'function' || unretired !== undefined && typeof unretired !== 'function') throw new TypeError('Native RAW requires trusted callable owner capabilities.');
   owner.#start = () => Reflect.apply(start, value, []) as ChildProcessWithoutNullStreams;
   if (typeof retire === 'function') owner.#retire = async () => { await Reflect.apply(retire, value, []); };
   if (typeof unretired === 'function') owner.#unretired = () => { Reflect.apply(unretired, value, []); };
   check(owner.#signal); return owner;
  } catch (caught) {
   let primary = caught; try { check(owner.#signal); } catch (reason) { primary = reason; }
   try { owner.#detach(); } catch (cleanup) { owner.#quarantine(cleanup); throw new AggregateError([primary, cleanup], 'Native RAW opening and listener retirement failed.', { cause: cleanup }); }
   throw primary;
  }
 }
 #assertAccepting(): void { if (this.#stopped || this.#closing || this.#cleanup.size) throw new Error('Native RAW owner is stopped, closed or quarantined.'); check(this.#signal); }
 withDecoded<Result>(value: unknown, consume: (view: Readonly<Decoded>) => Result | Promise<Result>, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Result> {
  let slot: ReturnType<typeof reserve>;
  try { this.#assertAccepting(); slot = reserve(); } catch (error) { return Promise.reject(error); }
  let resolve!: (result: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
  const work = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active = work;
  let signal = this.#signal, timer: ReturnType<typeof setTimeout> | undefined;
  const detaches: Array<() => void> = [], deadline = new Controller();
  const clearDeadline = (): void => { if (timer) clearTimeout(timer); timer = undefined; };
  const finish = (okay: boolean, result: unknown): void => {
   clearDeadline(); for (const detach of detaches.reverse()) { try { detach(); } catch (error) { this.#quarantine(error); } }
   if (this.#active === work) this.#active = undefined;
   if (this.#cleanup.size) { slot.quarantine(this); reject(new AggregateError([...(okay ? [] : [result]), ...this.#cleanup], 'Native RAW job retirement is unproved.')); }
   else { this.#held = undefined; slot.release(); if (okay) resolve(result as Result); else reject(result); }
  };
  try {
   const caller = ownSignal(options); if (caller !== undefined) assertPhotoStackQuerySignalV1(caller);
   const linked = link(caller, signal); signal = linked.signal; detaches.push(linked.detach);
   const timed = link(signal, Reflect.apply(SIGNAL, deadline, []) as AbortSignal); signal = timed.signal; detaches.push(timed.detach);
   const config = record(options, 'native RAW options', ['signal'], []);
   if ((Object.hasOwn(config, 'signal') ? field(config, 'signal', 'native RAW options') : undefined) !== caller) throw new TypeError('Native RAW cancellation changed during admission.');
   check(signal); const request = capture(value); if (typeof consume !== 'function') throw new TypeError('Native RAW requires an actual scoped consumer.'); check(signal); this.#held = { request, consume };
   timer = setTimeout(() => { Reflect.apply(ABORT, deadline, [new DOMException('Native RAW decode exceeded its actual deadline.', 'TimeoutError')]); }, IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
   void Promise.resolve().then(() => { check(signal); return this.#run(request, consume, signal, clearDeadline); }).then(
    result => { finish(true, result); }, (caught: unknown) => { let primary = caught; try { check(signal); } catch (reason) { primary = reason; } finish(false, primary); });
  } catch (caught) { let primary = caught; try { check(signal); } catch (reason) { primary = reason; } finish(false, primary); }
  return work;
 }
 #quarantine(error: unknown): void {
  this.#cleanup.add(error); quarantine(this);
  if (this.#notified) return; this.#notified = true;
  try { this.#unretired(); } catch (secondary) { this.#cleanup.add(secondary); }
 }
 async #run<Result>(request: Readonly<Request>, consume: (view: Readonly<Decoded>) => Result | Promise<Result>, signal: AbortSignal, decoderRetired: () => void): Promise<Result> {
  let peer: Process | undefined, plane: Uint8Array<ArrayBuffer> | undefined;
  let outcome: { value: Result } | { error: unknown }, subscribed = false;
  const terminate = (): void => { if (peer) void peer.retire(true).catch(error => { this.#quarantine(error); }); };
  try {
   check(signal); peer = new Process(this.#start, error => { this.#quarantine(error); }, this.#retire); this.#peer = peer; if (this.#held) this.#held.peer = peer;
   Reflect.apply(ADD, signal, ['abort', terminate, { once: true }]); subscribed = true; check(signal);
   await handshake(peer); check(signal);
   const begin = Buffer.alloc(44); begin[0] = MODES.indexOf(request.mode) + 1; begin[1] = TIERS.indexOf(request.tier); begin.writeBigUInt64BE(BigInt(request.byteLength), 4);
   Buffer.from(request.contentSha256, 'hex').copy(begin, 12);
   try { const reply = await peer.request(2, begin); try { exactEmpty(reply); } finally { reply.fill(0); } } finally { begin.fill(0); }
   const digest = createHash('sha256');
   for (let offset = 0; offset < request.byteLength; offset += CHUNK) {
    check(signal); const length = Math.min(CHUNK, request.byteLength - offset), borrowed = await request.read(offset, length, signal); check(signal);
    const chunk = copy(borrowed, length), packet = Buffer.alloc(8 + length); packet.writeBigUInt64BE(BigInt(offset), 0); Reflect.apply(SET, packet, [chunk, 8]);
    try {
     digest.update(chunk); const reply = await peer.request(3, packet);
     try { if (reply.byteLength !== 8 || reply.readBigUInt64BE(0) !== BigInt(offset + length)) throw new TypeError('Native RAW lost actual input backpressure acknowledgement.'); }
     finally { reply.fill(0); }
    } finally { chunk.fill(0); packet.fill(0); }
   }
   if (digest.digest('hex') !== request.contentSha256) throw new RangeError('Actual native RAW source SHA differs from its immutable binding.'); check(signal);
   let facts: ReturnType<typeof header>; const result = await peer.request(4, Buffer.alloc(0));
   try { facts = header(result, request); } finally { result.fill(0); }
   check(signal); plane = new Uint8Array(facts.byteLength); if (this.#held) this.#held.plane = plane; const output = createHash('sha256');
   for (let offset = 0; offset < facts.byteLength; offset += CHUNK) {
    check(signal); const length = Math.min(CHUNK, facts.byteLength - offset), packet = Buffer.alloc(12); packet.writeBigUInt64BE(BigInt(offset), 0); packet.writeUInt32BE(length, 8);
    let bytes: Buffer; try { bytes = await peer.request(5, packet); } finally { packet.fill(0); }
    try { if (bytes.byteLength !== length) throw new RangeError('Native RAW output chunk is not exact.'); output.update(bytes); Reflect.apply(SET, plane, [bytes, offset]); }
    finally { bytes.fill(0); }
   }
   if (output.digest('hex') !== facts.contentSha256) throw new RangeError('Actual native RAW output SHA differs from its result.'); check(signal);
   const release = await peer.request(6, Buffer.alloc(0)); try { exactEmpty(release); } finally { release.fill(0); }
   const exit = await peer.retire(false); if (exit.code !== 0 || exit.signal !== null) throw new Error('Actual native RAW child did not retire successfully before delivery.');
   await validatePlane(facts, plane, signal); check(signal); decoderRetired();
   const backing = plane.buffer, length = plane.byteLength;
   const value = await Reflect.apply(consume, undefined, [Object.freeze({ ...facts, bytes: plane })]) as Result;
   if (Reflect.apply(SIZE, backing, []) !== length) throw new TypeError('Native RAW consumer detached its borrowed plane.'); check(signal); outcome = { value };
  } catch (error) { outcome = { error }; }
  const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
  if (peer) { try { await peer.retire(true); } catch (error) { failures.push(error); this.#quarantine(error); } }
  if (subscribed) { try { Reflect.apply(REMOVE, signal, ['abort', terminate]); } catch (error) { failures.push(error); this.#quarantine(error); } }
  if (plane) { try { Reflect.apply(FILL, plane, [0]); } catch (error) { failures.push(error); this.#quarantine(error); } }
  if (!this.#cleanup.size) this.#peer = undefined;
  if (failures.length === 1) throw failures[0]; if (failures.length > 1) throw new AggregateError(failures, 'Native RAW work and actual retirement failed.');
  if ('value' in outcome) return outcome.value; throw new Error('Native RAW scope has no outcome.');
 }
 #stop(): void {
  if (this.#stopped) return; this.#stopped = true;
  try { Reflect.apply(ABORT, this.#shutdown, [new DOMException('Native RAW owner stopped.', 'AbortError')]); } catch (error) { this.#quarantine(error); }
  if (this.#peer) void this.#peer.retire(true).catch(error => { this.#quarantine(error); });
 }
 readonly stop = (): void => { this.#stop(); };
 close(): Promise<void> {
  if (this.#closing) return this.#closing;
  let resolve!: () => void, reject!: (error: unknown) => void;
  this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
  const active = this.#active; this.#stop();
  void Promise.allSettled(active ? [active] : []).then(() => {
   try { this.#detach(); } catch (error) { this.#quarantine(error); }
   if (this.#cleanup.size) throw new AggregateError([...this.#cleanup], 'Native RAW owner retirement is unproved.');
  }).then(resolve, reject); return this.#closing;
 }
}
function ownSignal(value: unknown): AbortSignal | undefined {
 const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
 if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new TypeError('Native RAW signal must be own data.');
 return descriptor?.value as AbortSignal | undefined;
}
function exactEmpty(bytes: Buffer): void { if (bytes.byteLength) throw new TypeError('Native RAW acknowledgement must be empty.'); }
async function handshake(peer: Process): Promise<void> {
 const nonce = randomBytes(32); let reply: Buffer | undefined;
 try {
  reply = await peer.request(1, nonce); let at = 32;
  if (reply.byteLength < 33 || !reply.subarray(0, 32).equals(nonce)) throw new TypeError('Native RAW handshake nonce is invalid.');
  const captured = reply;
  const text = (): string => { const size = captured[at++]!; if (!size || size > 128 || at + size > captured.byteLength) throw new TypeError('Native RAW handshake text is invalid.');
   const bytes = captured.subarray(at, at + size); if (bytes.some(byte => byte < 32 || byte > 126)) throw new TypeError('Native RAW handshake text is not ASCII.'); const value = bytes.toString('ascii'); at += size; return value; };
  if (text() !== 'lightscaper-libraw-native' || at + 2 > reply.byteLength || reply.readUInt16BE(at) !== 1) throw new TypeError('Native RAW engine identity is invalid.'); at += 2;
  if (text() !== '0.22.2' || at + 13 !== reply.byteLength) throw new TypeError('Native RAW upstream identity is invalid.');
  const target = process.platform === 'linux' ? process.arch === 'x64' ? 1 : process.arch === 'arm64' ? 2 : 0
   : process.platform === 'darwin' && process.arch === 'arm64' ? 3 : process.platform === 'win32' ? process.arch === 'x64' ? 4 : process.arch === 'arm64' ? 5 : 0 : 0;
  if (!target || reply[at] !== target || reply.readUInt32BE(at + 1) !== 64 * 1024 * 1024 || reply.readUInt32BE(at + 5) !== 256 * 1024 * 1024 || reply.readUInt32BE(at + 9) !== CHUNK)
   throw new RangeError('Native RAW compiled target or fixed capacities differ.');
 } finally { nonce.fill(0); reply?.fill(0); }
}
async function validatePlane(facts: ReturnType<typeof header>, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<void> {
 const view = new DataView(bytes.buffer); if (facts.format === 'jpeg') validateJpeg(facts, bytes); if (!facts.format.startsWith('rgba')) return;
 const stride = facts.bits / 8;
 for (let offset = 0; offset < bytes.byteLength; offset += stride * 4) {
  if (facts.format === 'rgba32fle') {
   for (let channel = 0; channel < 4; channel++) { const value = view.getFloat32(offset + channel * 4, true); if (!Number.isFinite(value) || channel === 3 && value !== 1) throw new RangeError('Native RAW Float32 plane is nonfinite or nonopaque.'); }
  } else if (facts.format === 'rgba16le' ? view.getUint16(offset + 6, true) !== 65535 : bytes[offset + 3] !== 255) throw new RangeError('Native RAW plane is not opaque.');
  if (offset && offset % (1024 * 1024) === 0) { await setImmediate(); check(signal); }
 }
}

function validateJpeg(facts: ReturnType<typeof header>, bytes: Uint8Array): void {
 if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw new TypeError('Native JPEG extraction has no SOI.');
 let at = 2;
 while (at + 4 <= bytes.length) {
  if (bytes[at++] !== 255) break; while (at < bytes.length && bytes[at] === 255) at++; if (at >= bytes.length) break;
  const marker = bytes[at++]!; if (marker === 217 || marker === 218) break; if (marker === 1 || marker >= 208 && marker <= 215) continue;
  if (at + 2 > bytes.length) break; const size = bytes[at]! * 256 + bytes[at + 1]!; if (size < 2 || size > bytes.length - at) break;
  if (marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207) {
   if (size < 8 || bytes[at + 2] !== facts.bits || bytes[at + 3]! * 256 + bytes[at + 4]! !== facts.height
    || bytes[at + 5]! * 256 + bytes[at + 6]! !== facts.width || bytes[at + 7] !== facts.channels || size !== 8 + 3 * facts.channels) break;
   return;
  } at += size;
 } throw new RangeError('Native JPEG extraction geometry differs from its actual header.');
}
