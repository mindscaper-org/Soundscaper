/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { readDesktopPhotoLibrarySessionHandleCurrentV1 as handleOf } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { captureLightscaperNativePhotoMediaRawInputsCurrentV1 as captureMedia,
 lightscaperNativePhotoMediaRawInputCleanupFailureCurrentV1 as cleanupFailure } from './lightscaper-native-photo-media-current-v1.ts';
import { LightscaperNativePhotoSessionHandlesCurrentV1 as Handles } from './lightscaper-native-photo-session-handles-current-v1.ts';
import { copyLightscaperNativePhotoSessionBytesCurrentV1 as copy } from './lightscaper-native-photo-session-bytes-current-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check, linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import type { LightscaperNativePhotoUploadFileCurrentV1 as Upload, LightscaperNativePhotoUploadReadCurrentV1 as Read } from './lightscaper-native-photo-upload-file-current-v1.ts';
import type { LightscaperNativePhotoRawInputViewCurrentV1 as View } from './lightscaper-native-photo-raw-inputs-current-v1.ts';
type Options = Readonly<{ signal?: AbortSignal }>;
type Scope = Readonly<{ signal: AbortSignal; assertCurrent(): void }>;
type Borrow = (id: string, consume: (view: Readonly<View>) => unknown | PromiseLike<unknown>, options?: Options) => Promise<unknown>;
type Booking = ReturnType<Handles['reserve']>;
type Handle = Readonly<{ kind: 'raw-input'; id: string }>;
interface Entry {
 readonly handle: Handle; readonly booking: Booking; readonly expectedBytes: number; readonly sha256: string;
 opening: Promise<Upload>; upload?: Upload; read?: Read; offset: number; sequence: number; consumed: boolean;
 writing?: Promise<unknown>; finishing?: Promise<unknown>; borrowing?: Promise<unknown>; closing?: Promise<void>;
}
const QUARANTINE = new Set<object>();

/** One fixed Main family. Handles authenticates purpose and retains the same
 * slot from staged bytes through completed one-use input until explicit close.
 * The parent closes RAW output callbacks before retiring this registry. */
export class LightscaperNativePhotoSessionRawInputsCurrentV1 {
 readonly #media: ReturnType<typeof captureMedia>; readonly #handles: Handles; readonly #scope: Scope; readonly #notify: () => void;
 readonly #linked: Borrow | undefined; readonly #entries = new Map<string, Entry>(); readonly #tasks = new Set<Promise<unknown>>();
 #chunkBusy = false; #closed = false; #notified = false; #closing: Promise<void> | undefined; readonly #cleanup = new Set<unknown>();
 private constructor(media: ReturnType<typeof captureMedia>, handles: Handles, scope: Scope, notify: () => void, linked?: Borrow) {
  this.#media = media; this.#handles = handles; this.#scope = scope; this.#notify = notify; this.#linked = linked;
 }
 static create(value: Readonly<{ media: unknown; handles: Handles; scope: Scope; unretired(): void; withLinkedInput?: Borrow }>): LightscaperNativePhotoSessionRawInputsCurrentV1 {
  const input = record(value, 'Main RAW input registry', ['media', 'handles', 'scope', 'unretired', 'withLinkedInput'], ['media', 'handles', 'scope', 'unretired']);
  const media = captureMedia(field(input, 'media', 'Main RAW input registry')), handles = field(input, 'handles', 'Main RAW input registry');
  const selected = field(input, 'scope', 'Main RAW input registry'), scope = record(selected, 'Main RAW input scope', ['signal', 'assertCurrent']);
  const signal = field(scope, 'signal', 'Main RAW input scope'); assertPhotoStackQuerySignalV1(signal);
  const assert = field(scope, 'assertCurrent', 'Main RAW input scope'), notify = field(input, 'unretired', 'Main RAW input registry');
  const linked = Object.hasOwn(input, 'withLinkedInput') ? field(input, 'withLinkedInput', 'Main RAW input registry') : undefined;
  if (!(handles instanceof Handles) || typeof assert !== 'function' || typeof notify !== 'function' || linked !== undefined && typeof linked !== 'function') throw new TypeError('Main RAW input requires actual registry owners.');
  const owner = new LightscaperNativePhotoSessionRawInputsCurrentV1(media, handles, { signal, assertCurrent: () => { Reflect.apply(assert, selected, []); } },
   () => { Reflect.apply(notify, value, []); }, typeof linked === 'function' ? (id, consume, options) => Reflect.apply(linked, value, [id, consume, options]) as Promise<unknown> : undefined);
  owner.#current(); return owner;
 }
 #current(): void { if (this.#closed || this.#cleanup.size) throw new Error('Main RAW input registry is closed or quarantined.'); check(this.#scope.signal); this.#scope.assertCurrent(); check(this.#scope.signal); }
 #own<Value>(task: Promise<Value>): Promise<Value> { this.#tasks.add(task); void task.then(() => { this.#tasks.delete(task); }, () => { this.#tasks.delete(task); }); return task; }
 execute(value: unknown, signal: AbortSignal, reserved?: Booking): Promise<unknown> {
  // The authenticated parent already captured its fixed operation header.
  // Cleanup stays available after stop and outside normal RPC data capacity.
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const work = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); void this.#own(work); let delegated = false;
  try {
   const input = record(value, 'Main RAW input packet', ['operation', 'handle', 'expectedBytes', 'expectedSha256', 'sequence', 'offset', 'bytes'], ['operation']);
   const operation = field(input, 'operation', 'Main RAW input packet');
   if (operation === 'close') {
    record(value, 'RAW input close', ['operation', 'handle']);
    void this.#handles.close(field(input, 'handle', 'RAW input close'), 'raw-input').then(resolve, reject);
   } else {
    this.#current(); assertPhotoStackQuerySignalV1(signal); check(signal);
    let actual: Promise<unknown>;
    if (operation === 'begin') { record(value, 'RAW input begin', ['operation', 'expectedBytes', 'expectedSha256']); delegated = true; actual = this.#begin(input, signal, reserved); }
    else if (operation === 'write') { record(value, 'RAW input write', ['operation', 'handle', 'sequence', 'offset', 'bytes']); actual = this.#write(input, signal); }
    else if (operation === 'finish') { record(value, 'RAW input finish', ['operation', 'handle']); actual = this.#finish(this.#entry(field(input, 'handle', 'RAW input finish')), signal); }
    else throw new TypeError('Unknown Main RAW input operation.');
    void actual.then(resolve, reject);
   }
  } catch (error) { if (!delegated) reserved?.abandon(); reject(error); } return work;
 }
 #entry(value: unknown): Entry {
  const handle = handleOf(value, 'raw-input'), entry = this.#entries.get(handle.id);
  if (!entry || entry.closing) throw new ReferenceError('Main RAW input is missing or retiring.'); this.#handles.owner(handle, 'raw-input'); return entry;
 }
 #begin(packet: Readonly<Record<string, unknown>>, signal: AbortSignal, reserved?: Booking): Promise<unknown> {
  const booking = reserved ?? this.#handles.reserve('raw-input'); let entry: Entry | undefined;
  try {
   const length = field(packet, 'expectedBytes', 'RAW input begin'), sha = field(packet, 'expectedSha256', 'RAW input begin');
   if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1 || length > 64 * 1024 * 1024 || typeof sha !== 'string' || !/^[a-f0-9]{64}$/u.test(sha)) throw new RangeError('RAW upload leaves its full encoded input profile.');
   const handle = handleOf(booking.handle, 'raw-input');
   let opened!: (value: Upload) => void, refused!: (error: unknown) => void; const opening = new Promise<Upload>((yes, no) => { opened = yes; refused = no; });
   entry = { handle, booking, expectedBytes: length, sha256: sha, opening, offset: 0, sequence: 0, consumed: false };
   const issued = entry; this.#entries.set(handle.id, issued); booking.publish(Object.freeze({ close: () => this.#retire(issued) }));
   try { void this.#media.begin(Object.freeze({ expectedBytes: length, expectedSha256: sha })).then(opened, refused); } catch (error) { refused(error); }
   return issued.opening.then(async upload => { issued.upload = upload; this.#current(); check(signal); return Object.freeze({ handle, maximumChunkBytes: 1048576, bytesWritten: 0 }); })
    .catch(async (primary: unknown) => {
     if (cleanupFailure(primary)) this.#quarantine(primary);
     try { await this.#retire(issued); booking.abandon(); } catch (cleanup) { this.#quarantine(cleanup); throw new AggregateError([primary, cleanup], 'RAW input admission and actual file retirement failed.', { cause: cleanup }); }
     throw primary;
    });
  } catch (error) { if (!entry) booking.abandon(); throw error; }
 }
 #write(packet: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<unknown> {
  const entry = this.#entry(field(packet, 'handle', 'RAW input write'));
  if (this.#chunkBusy || entry.writing || entry.finishing || entry.consumed) throw new Error('RAW input chunk is busy, complete or consumed.');
  const sequence = field(packet, 'sequence', 'RAW input write'), offset = field(packet, 'offset', 'RAW input write');
  if (sequence !== entry.sequence || offset !== entry.offset) throw new RangeError('RAW input write sequence is stale.');
  this.#chunkBusy = true; let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = copy(field(packet, 'bytes', 'RAW input write')); if (bytes.byteLength < 1 || entry.offset + bytes.byteLength > entry.expectedBytes) { bytes.fill(0); throw new RangeError('RAW input chunk exceeds its exact upload.'); } }
  catch (error) { this.#chunkBusy = false; throw error; }
  const actual = (async () => { const upload = await entry.opening; this.#current(); check(signal); await upload.write(bytes); entry.offset += bytes.byteLength; entry.sequence++;
   return Object.freeze({ sequence, offset: entry.offset }); })();
  entry.writing = actual;
  return actual.finally(() => { bytes.fill(0); entry.writing = undefined; this.#chunkBusy = false; });
 }
 #finish(entry: Entry, signal: AbortSignal): Promise<unknown> {
  if (entry.finishing) return entry.finishing;
  if (entry.writing || entry.offset !== entry.expectedBytes || entry.consumed) return Promise.reject(new Error('RAW input is incomplete, busy or consumed.'));
  entry.finishing = (async () => {
   const upload = await entry.opening; this.#current(); check(signal); const proof = await upload.finish(); this.#current(); check(signal);
   const source = await this.#media.consume(proof); entry.read = source; this.#current(); check(signal);
   if (source.byteLength !== entry.expectedBytes || source.contentSha256 !== entry.sha256) throw new Error('Actual completed RAW file differs from its captured input.');
   return Object.freeze({ handle: entry.handle, byteLength: entry.expectedBytes, contentSha256: entry.sha256 });
  })(); return entry.finishing;
 }
 withInput<Value>(id: string, consume: (view: Readonly<View>) => Value | PromiseLike<Value>, options: Options = {}): Promise<Value> {
  try {
   this.#current(); if (typeof id !== 'string' || !/^[a-f0-9]{64}$/u.test(id)) throw new TypeError('RAW input requires its actual issued identity.');
   const entry = this.#entries.get(id);
   if (!entry) {
    if (!this.#linked) throw new ReferenceError('RAW input handle is not owned.');
    let resolve!: (value: Value | PromiseLike<Value>) => void, reject!: (error: unknown) => void; const work = new Promise<Value>((yes, no) => { resolve = yes; reject = no; }); void this.#own(work);
    try { void (this.#linked(id, consume, options) as Promise<Value>).then(resolve, reject); } catch (error) { reject(error); } return work;
   }
   if (!entry.read || entry.closing || entry.consumed) throw new Error('RAW input is incomplete, retiring or consumed.');
   entry.consumed = true;
   let resolve!: (value: Value | PromiseLike<Value>) => void, reject!: (error: unknown) => void;
   const work = new Promise<Value>((yes, no) => { resolve = yes; reject = no; }); entry.borrowing = work; void this.#own(work);
   let selected: ReturnType<typeof link> | undefined;
   try {
    const descriptor = Object.getOwnPropertyDescriptor(options, 'signal'), caller: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    if (caller !== undefined) assertPhotoStackQuerySignalV1(caller); selected = link(caller as AbortSignal | undefined, this.#scope.signal);
    const config = record(options, 'RAW input borrow options', ['signal'], []);
    if ((Object.hasOwn(config, 'signal') ? field(config, 'signal', 'RAW input borrow options') : undefined) !== caller || typeof consume !== 'function') throw new TypeError('RAW input borrow changed its native cancellation/consumer.');
    const linked = selected;
    const finish = (outcome: { value: Value } | { error: unknown }): void => {
     try { linked.detach(); } catch (cleanup) { this.#quarantine(cleanup); reject(new AggregateError([...('error' in outcome ? [outcome.error] : []), cleanup], 'RAW input consumer and signal retirement failed.', { cause: cleanup })); return; }
     if ('error' in outcome) reject(outcome.error); else resolve(outcome.value);
    };
    void this.#borrow(entry, consume, linked.signal).then(value => { finish({ value }); }, (error: unknown) => { finish({ error }); });
   } catch (caught) {
    let primary = caught; try { check(selected?.signal ?? this.#scope.signal); } catch (reason) { primary = reason; }
    try { selected?.detach(); } catch (cleanup) { this.#quarantine(cleanup); primary = new AggregateError([primary, cleanup], 'RAW input borrow admission and signal retirement failed.', { cause: cleanup }); } reject(primary);
   } return work;
  } catch (error) { return Promise.reject(error); }
 }
 async #borrow<Value>(entry: Entry, consume: (view: Readonly<View>) => Value | PromiseLike<Value>, signal: AbortSignal): Promise<Value> {
  const source = entry.read!; const read = source.read, close = source.close; const active = new Set<Promise<Uint8Array>>(); let ended = false, busy = false;
  let failed = false, primary: unknown, result!: Value;
  const current = () => { this.#current(); check(signal); };
  try {
   current(); const view = Object.freeze<View>({ byteLength: entry.expectedBytes, contentSha256: entry.sha256, read: (offset, length) => {
    try { current(); if (ended || busy) throw new Error('RAW input borrower is retired or pulling.'); busy = true; } catch (error) { return Promise.reject(error); }
    const work = Promise.resolve().then(async () => { const bytes = await Reflect.apply(read, source, [offset, length, { signal }]) as Uint8Array;
     try { current(); return bytes; } catch (error) { bytes.fill(0); throw error; } }); active.add(work);
    void work.then(() => { active.delete(work); busy = false; }, () => { active.delete(work); busy = false; }); return work;
   } }); result = await consume(view); current();
  } catch (error) { failed = true; primary = error; }
  ended = true; const failures: unknown[] = failed ? [primary] : [];
  const reads = await Promise.allSettled([...active]); for (const read of reads) if (read.status === 'rejected' && !failures.some(held => Object.is(held, read.reason))) failures.push(read.reason as unknown);
  try { await Reflect.apply(close, source, []); } catch (cleanup) { this.#quarantine(cleanup); failures.push(cleanup); }
  if (failures.length === 1) throw failures[0]; if (failures.length > 1) throw new AggregateError(failures, 'RAW input consumer and actual source retirement failed.', { cause: failures[0] }); return result;
 }
 #retire(entry: Entry): Promise<void> {
  if (entry.closing) return entry.closing;
  let resolve!: () => void, reject!: (error: unknown) => void; entry.closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void (async () => {
   await Promise.allSettled([entry.opening, ...(entry.writing ? [entry.writing] : []), ...(entry.finishing ? [entry.finishing] : []), ...(entry.borrowing ? [entry.borrowing] : [])]);
   const upload = entry.upload ?? (await entry.opening.catch(() => undefined)); if (upload) await upload.close();
   if (this.#cleanup.size) throw new AggregateError([...this.#cleanup], 'RAW input retirement remains quarantined.'); this.#entries.delete(entry.handle.id);
  })().then(resolve, error => { this.#quarantine(error); reject(error); }); return entry.closing;
 }
 #quarantine(error: unknown): void { this.#cleanup.add(error); QUARANTINE.add(this); this.#closed = true; if (this.#notified) return; this.#notified = true; try { this.#notify(); } catch (secondary) { this.#cleanup.add(secondary); } }
 close(): Promise<void> {
  if (this.#closing) return this.#closing; this.#closed = true;
  let resolve!: () => void, reject!: (error: unknown) => void; this.#closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const tasks = [...this.#tasks], retirements = [...this.#entries.values()].map(entry => this.#handles.close(entry.handle, 'raw-input'));
  void Promise.allSettled([...tasks, ...retirements]).then(() => { if (this.#cleanup.size) throw new AggregateError([...this.#cleanup], 'Main RAW input registry actual retirement is unproved.'); }).then(resolve, reject); return this.#closing;
 }
}
