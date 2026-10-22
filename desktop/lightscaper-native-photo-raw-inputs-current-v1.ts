/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { types } from 'node:util';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { readPhotoLibraryRawImportFrameCurrentV1 as readFrame,
 type PhotoLibraryRawResultCurrentV1 as Result } from '../src/lightscaper/controller/photo-library-raw-source-current-v1.ts';
import type { PhotoLibraryRawImportFrameCurrentV1 as Frame } from '../src/lightscaper/controller/photo-library-raw-import-current-v1.ts';
import { LightscaperNativePhotoRawCurrentV1 as Raw, type LightscaperNativePhotoRawDecodedCurrentV1 as Decoded } from './lightscaper-native-photo-raw-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check, linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import type { LightscaperNativePhotoRawPreparedCurrentV1 } from './lightscaper-native-photo-raw-originals-current-v1.ts';
type Options = Readonly<{ signal?: AbortSignal }>;
export interface LightscaperNativePhotoRawInputViewCurrentV1 {
 readonly byteLength: number; readonly contentSha256: string;
 read(offset: number, length: number, options?: Options): Promise<Uint8Array>;
}
export interface LightscaperNativePhotoRawInputsOptionsCurrentV1 {
 readonly prepare: (options: Readonly<{ signal: AbortSignal }>) => Promise<Readonly<LightscaperNativePhotoRawPreparedCurrentV1> | undefined>;
 /** Main-installed proof registry only; its callback/terminal holds the actual
  * namespace-bound completed upload or native linked file through delivery. */
 readonly withInput: (id: string, consume: (view: Readonly<LightscaperNativePhotoRawInputViewCurrentV1>) => unknown | PromiseLike<unknown>, options?: Options) => Promise<unknown>;
 readonly scope: Readonly<{ signal: AbortSignal; assertCurrent(): void }>;
 readonly unretired: () => void;
}
type Facet = Readonly<Pick<LightscaperNativePhotoRawInputsCurrentV1, 'withFrame'>>;
const ISSUED = new WeakMap<object, Facet>(), QUARANTINED = new Set<object>();
const Controller = AbortController, ABORT = Controller.prototype.abort, SIGNAL = Object.getOwnPropertyDescriptor(Controller.prototype, 'signal')!.get!;
let active: object | undefined;

/** Separate prepublication purpose. Only a trusted Main registry can lend
 * actual completed-file bytes; scalar descriptors and renderer Blobs cannot. */
export class LightscaperNativePhotoRawInputsCurrentV1 {
 readonly #stop = new Controller(); readonly #cleanup = new Set<unknown>(); readonly #held = new Set<object>();
 #signal = Reflect.apply(SIGNAL, this.#stop, []) as AbortSignal;
 #detach = (): void => undefined; #assert = (): void => undefined; #notify = (): void => undefined;
 #prepare!: LightscaperNativePhotoRawInputsOptionsCurrentV1['prepare']; #input!: LightscaperNativePhotoRawInputsOptionsCurrentV1['withInput'];
 #work: Promise<unknown> | undefined; #closing: Promise<void> | undefined; #stopped = false; #notified = false;
 private constructor() { ISSUED.set(this, Object.freeze({ withFrame: this.withFrame })); }
 static create(value: LightscaperNativePhotoRawInputsOptionsCurrentV1): LightscaperNativePhotoRawInputsCurrentV1 {
  const owner = new LightscaperNativePhotoRawInputsCurrentV1();
  try {
   const input = record(value, 'native RAW input owner', ['prepare', 'withInput', 'scope', 'unretired']);
   const scopeValue = field(input, 'scope', 'native RAW input owner'), scope = record(scopeValue, 'native RAW input scope', ['signal', 'assertCurrent']);
   const signal = field(scope, 'signal', 'native RAW input scope'); assertPhotoStackQuerySignalV1(signal);
   const selected = link(signal, owner.#signal); owner.#signal = selected.signal; owner.#detach = selected.detach;
   const prepare = field(input, 'prepare', 'native RAW input owner'), borrow = field(input, 'withInput', 'native RAW input owner');
   const assert = field(scope, 'assertCurrent', 'native RAW input scope'), notify = field(input, 'unretired', 'native RAW input owner');
   if (typeof prepare !== 'function' || typeof borrow !== 'function' || typeof assert !== 'function' || typeof notify !== 'function') throw new TypeError('Native RAW input requires its actual Main capabilities.');
   owner.#prepare = options => Reflect.apply(prepare, value, [options]) as ReturnType<LightscaperNativePhotoRawInputsOptionsCurrentV1['prepare']>;
   owner.#input = (id, consume, options) => Reflect.apply(borrow, value, [id, consume, options]) as Promise<unknown>;
   owner.#assert = () => { Reflect.apply(assert, scopeValue, []); }; owner.#notify = () => { Reflect.apply(notify, value, []); };
   owner.#current(); return owner;
  } catch (caught) {
   let primary = caught; try { check(owner.#signal); } catch (reason) { primary = reason; }
   try { owner.#detach(); } catch (cleanup) { owner.#quarantine(cleanup); throw new AggregateError([primary, cleanup], 'Native RAW input opening and signal retirement failed.', { cause: cleanup }); } throw primary;
  }
 }
 #current(): void { if (this.#stopped || this.#closing || this.#cleanup.size) throw new Error('Native RAW input owner is stopped or quarantined.'); check(this.#signal); this.#assert(); check(this.#signal); }
 readonly withFrame = <Value>(id: string, consume: (view: Readonly<Frame>) => Value | Promise<Value>, options: Options = {}): Promise<Result<Value>> => {
  try { this.#current(); if (active || QUARANTINED.size) throw new Error('Native RAW input lane is busy or quarantined.'); } catch (error) { return Promise.reject(error); }
  const token = Object.freeze({}); active = token;
  let resolve!: (result: Result<Value>) => void, reject!: (reason: unknown) => void;
  const work = new Promise<Result<Value>>((yes, no) => { resolve = yes; reject = no; }); this.#work = work;
  let selected: ReturnType<typeof link> | undefined, signal = this.#signal;
  const finish = (outcome: { value: Result<Value> } | { error: unknown }): void => {
   try { selected?.detach(); } catch (cleanup) { this.#quarantine(cleanup); }
   if (this.#work === work) this.#work = undefined;
   if (this.#cleanup.size) { reject(new AggregateError([...('error' in outcome ? [outcome.error] : []), ...this.#cleanup], 'Native RAW input retirement is unproved.')); return; }
   this.#held.clear(); if (active === token) active = undefined; if ('error' in outcome) reject(outcome.error); else resolve(outcome.value);
  };
  try {
   const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
   const caller: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
   if (caller !== undefined) assertPhotoStackQuerySignalV1(caller); selected = link(caller as AbortSignal | undefined, signal); signal = selected.signal;
   const config = record(options, 'native RAW input options', ['signal'], []);
   if ((Object.hasOwn(config, 'signal') ? field(config, 'signal', 'native RAW input options') : undefined) !== caller) throw new TypeError('Native RAW input signal changed during admission.');
   check(signal); if (typeof id !== 'string' || !/^[a-f0-9]{64}$/u.test(id) || typeof consume !== 'function') throw new TypeError('Native RAW requires its genuine input handle and scoped consumer.');
   this.#held.add(consume); check(signal);
   void Promise.resolve().then(() => this.#run(id, consume, signal)).then(value => { finish({ value }); }, (caught: unknown) => {
    let primary = caught; try { check(signal); } catch (reason) { primary = reason; } finish({ error: primary });
   });
  } catch (caught) { let primary = caught; try { check(signal); } catch (reason) { primary = reason; } finish({ error: primary }); } return work;
 };
 async #run<Value>(id: string, consume: (view: Readonly<Frame>) => Value | Promise<Value>, signal: AbortSignal): Promise<Result<Value>> {
  let outcome: { value: Result<Value> } | { error: unknown } | undefined;
  try {
   this.#current(); check(signal);
   await this.#input(id, async source => {
    this.#held.add(source);
    // Borrower failures are data until genuine source callback retirement;
    // an arbitrary consumer AggregateError cannot manufacture quarantine.
    try {
     this.#current(); check(signal);
     const input = record(source, 'actual native RAW input', ['byteLength', 'contentSha256', 'read', 'close'], ['byteLength', 'contentSha256', 'read']);
     const length = field(input, 'byteLength', 'actual native RAW input'), sha = field(input, 'contentSha256', 'actual native RAW input'), read = field(input, 'read', 'actual native RAW input');
     if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1 || typeof sha !== 'string' || !/^[a-f0-9]{64}$/u.test(sha) || typeof read !== 'function') throw new TypeError('Actual RAW input has invalid native byte authority.');
     if (length > 64 * 1024 * 1024) { outcome = { value: Object.freeze({ outcome: 'web-fallback', reason: 'unsupported-representation' }) }; return; }
     outcome = { value: await this.#decode({ byteLength: length, contentSha256: sha,
      read: (offset, length, options) => Reflect.apply(read, source, [offset, length, options]) as Promise<Uint8Array> }, consume, signal) };
    } catch (error) { outcome = { error }; }
   }, { signal });
  } catch (error) {
   let cancelled = false; try { check(signal); } catch (reason) { cancelled = Object.is(reason, error); }
   if (!cancelled && types.isNativeError(error) && Object.getOwnPropertyDescriptor(error, 'errors') !== undefined) this.#quarantine(error);
   if (outcome && 'error' in outcome && !Object.is(outcome.error, error)) throw new AggregateError([outcome.error, error], 'Native RAW work and actual input retirement failed.', { cause: error }); throw error;
  }
  check(signal); this.#current(); if (!outcome) throw new Error('Actual RAW input has no terminal outcome.'); if ('error' in outcome) throw outcome.error; return outcome.value;
 }
 async #decode<Value>(source: Readonly<LightscaperNativePhotoRawInputViewCurrentV1>, consume: (view: Readonly<Frame>) => Value | Promise<Value>, signal: AbortSignal): Promise<Result<Value>> {
  this.#current(); check(signal); const prepared = await this.#prepare({ signal });
  if (!prepared) { this.#current(); check(signal); return Object.freeze({ outcome: 'web-fallback', reason: 'native-unavailable' }); }
  this.#held.add(prepared); let start: unknown, close: unknown;
  try {
   const s = Object.getOwnPropertyDescriptor(prepared, 'start'), c = Object.getOwnPropertyDescriptor(prepared, 'close');
   start = s && Object.hasOwn(s, 'value') ? s.value : undefined; close = c && Object.hasOwn(c, 'value') ? c.value : undefined;
   if (typeof start !== 'function' || typeof close !== 'function') throw new TypeError('Actual prepared RAW input child has no retirement methods.');
  } catch (error) { this.#quarantine(error); throw error; }
  const capturedStart = start, capturedClose = close; let raw: Raw | undefined, outcome: { value: Result<Value> } | { error: unknown };
  try {
   this.#current(); check(signal); raw = Raw.create({ start: () => Reflect.apply(capturedStart, prepared, []) as ChildProcessWithoutNullStreams, retire: async () => { await Reflect.apply(capturedClose, prepared, []); }, signal,
    unretired: () => { this.#quarantine(new Error('Actual native RAW input child did not retire.')); } }); this.#held.add(raw);
   outcome = { value: await raw.withDecoded({ mode: 'neutral', tier: null, source }, async decoded => {
    check(signal); this.#current(); const view = convert(decoded, source), value = await consume(view); check(signal); this.#current(); return Object.freeze({ outcome: 'native', value });
   }, { signal }) };
  } catch (error) { outcome = { error }; }
  const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
  if (raw) try { await raw.close(); } catch (error) { failures.push(error); this.#quarantine(error); }
  try { await Reflect.apply(capturedClose, prepared, []); } catch (error) { failures.push(error); this.#quarantine(error); }
  if (!this.#cleanup.size) { this.#held.delete(prepared); if (raw) this.#held.delete(raw); }
  if (failures.length === 1) throw failures[0]; if (failures.length > 1) throw new AggregateError(failures, 'Native RAW input and prepared-child cleanup failed.', { cause: failures[0] });
  if ('value' in outcome) return outcome.value; throw new Error('Native RAW input has no completed result.');
 }
 #quarantine(error: unknown): void { this.#cleanup.add(error); QUARANTINED.add(this); if (this.#notified) return; this.#notified = true; try { this.#notify(); } catch (secondary) { this.#cleanup.add(secondary); } }
 #stopOwner(): void { if (this.#stopped) return; this.#stopped = true; try { Reflect.apply(ABORT, this.#stop, [new DOMException('Native RAW input stopped.', 'AbortError')]); } catch (error) { this.#quarantine(error); } }
 readonly stop = (): void => { this.#stopOwner(); };
 close(): Promise<void> {
  if (this.#closing) return this.#closing;
  let resolve!: () => void, reject!: (reason: unknown) => void; this.#closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const work = this.#work; this.#stopOwner(); void Promise.allSettled(work ? [work] : []).then(() => {
   try { this.#detach(); } catch (error) { this.#quarantine(error); } if (this.#cleanup.size) throw new AggregateError([...this.#cleanup], 'Native RAW input actual retirement is unproved.');
  }).then(resolve, reject); return this.#closing;
 }
}
export function captureLightscaperNativePhotoRawInputsCurrentV1(value: unknown): Facet {
 const facet = value !== null && typeof value === 'object' ? ISSUED.get(value) : undefined;
 if (!facet) throw new TypeError('Native RAW input tickets require the actual Main source owner.'); return facet;
}
function convert(decoded: Readonly<Decoded>, input: Readonly<LightscaperNativePhotoRawInputViewCurrentV1>): Readonly<Frame> {
 if (decoded.format !== 'rgba16le') throw new TypeError('Actual native RAW import requires its full canonical word plane.');
 return readFrame({ input: Object.freeze({ byteLength: input.byteLength, contentSha256: input.contentSha256 }), decoder: { schemaVersion: 1, engine: 'lightscaper-libraw-native', engineVersion: 1, upstream: '0.22.2', profile: 'neutral-linear-srgb16', profileVersion: 1 },
  profile: 'canonical', frame: { descriptor: { schemaVersion: 1, width: decoded.width, height: decoded.height, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' },
   pixels: new Uint16Array(decoded.bytes.buffer) }, rawFlip: decoded.rawFlip, exposureScale: decoded.exposureScale, contentSha256: decoded.contentSha256 });
}
