/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { types } from 'node:util';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from './lightscaper-native-catalog-store-current-v1.ts';
import { LightscaperNativePhotoOriginalsCurrentV1 as Originals } from './lightscaper-native-photo-originals-current-v1.ts';
import { LightscaperNativePhotoRawCurrentV1 as Raw, type LightscaperNativePhotoRawDecodedCurrentV1 as Decoded } from './lightscaper-native-photo-raw-current-v1.ts';
import { linkLightscaperNativePhotoMediaSignalsCurrentV1 as link, checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { readPhotoLibraryRawFrameRequestCurrentV1 as frameRequest, readPhotoLibraryRawPreviewRequestCurrentV1 as previewRequest,
 readPhotoLibraryRawFrameCurrentV1 as frameView, readPhotoLibraryRawPreviewCurrentV1 as previewView,
 type PhotoLibraryRawSourceCurrentV1 as Source, type PhotoLibraryRawFrameRequestCurrentV1 as FrameRequest,
 type PhotoLibraryRawPreviewRequestCurrentV1 as PreviewRequest, type PhotoLibraryRawFrameCurrentV1 as Frame,
 type PhotoLibraryRawPreviewCurrentV1 as Preview, type PhotoLibraryRawProfileCurrentV1 as Profile,
 type PhotoLibraryRawResultCurrentV1 as Result } from '../src/lightscaper/controller/photo-library-raw-source-current-v1.ts';
export interface LightscaperNativePhotoRawPreparedCurrentV1 {
 readonly start: () => ChildProcessWithoutNullStreams;
 close(): Promise<void>;
}
export interface LightscaperNativePhotoRawOriginalsOptionsCurrentV1 {
 readonly catalog: Catalog; readonly originals: Originals;
 readonly prepare: (options: Readonly<{ signal: AbortSignal }>) => Promise<Readonly<LightscaperNativePhotoRawPreparedCurrentV1> | undefined>;
 readonly scope: Readonly<{ signal: AbortSignal; assertCurrent(): void }>;
 readonly unretired: () => void;
}
type Options = Readonly<{ signal?: AbortSignal }>;
type Authority = FrameRequest | PreviewRequest;
type ReaderView = Parameters<Parameters<Originals['withOriginal']>[1]>[0];
const Controller = AbortController, ABORT = Controller.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(Controller.prototype, 'signal')!.get!;
const quarantined = new Set<object>();
const ISSUED = new WeakMap<object, Readonly<Source>>();
let active: object | undefined;

/** Main-only composition over the actual same-generation Catalog and Reader.
 * The optional prepare callback is trusted launch ownership, never wire data.
 * Every Native result keeps the real Original callback/pin through delivery. */
export class LightscaperNativePhotoRawOriginalsCurrentV1 {
 readonly #stop = new Controller(); readonly #cleanup = new Set<unknown>(); readonly #held = new Set<object>();
 #signal = Reflect.apply(SIGNAL, this.#stop, []) as AbortSignal;
 #detach = (): void => undefined; #assertScope = (): void => undefined; #unretired = (): void => undefined;
 #load!: Catalog['loadPhoto']; #read!: Originals['withOriginal'];
 #prepare!: LightscaperNativePhotoRawOriginalsOptionsCurrentV1['prepare'];
 #active: Promise<unknown> | undefined; #stopped = false; #notified = false; #closing: Promise<void> | undefined;
 readonly raw: Readonly<Source> = Object.freeze<Source>({
  withFrame: (value, consume, options) => this.#admit(value, consume, options, false),
  withPreview: (value, consume, options) => this.#admit(value, view => consume(view as Readonly<Preview>), options, true),
 });
 private constructor() { ISSUED.set(this, this.raw); }
 static create(value: LightscaperNativePhotoRawOriginalsOptionsCurrentV1): LightscaperNativePhotoRawOriginalsCurrentV1 {
  const owner = new LightscaperNativePhotoRawOriginalsCurrentV1();
  try {
   const input = record(value, 'native RAW Originals options', ['catalog', 'originals', 'prepare', 'scope', 'unretired']);
   const selected = field(input, 'scope', 'native RAW Originals options');
   const scope = record(selected, 'native RAW selected scope', ['signal', 'assertCurrent']);
   const signal = field(scope, 'signal', 'native RAW selected scope'); assertPhotoStackQuerySignalV1(signal);
   const linked = link(signal, owner.#signal); owner.#signal = linked.signal; owner.#detach = linked.detach;
   const assert: unknown = field(scope, 'assertCurrent', 'native RAW selected scope');
   const catalog = field(input, 'catalog', 'native RAW Originals options'), originals = field(input, 'originals', 'native RAW Originals options');
   const prepare = field(input, 'prepare', 'native RAW Originals options'), unretired = field(input, 'unretired', 'native RAW Originals options');
   if (!(catalog instanceof Catalog) || !(originals instanceof Originals) || typeof prepare !== 'function' || typeof assert !== 'function' || typeof unretired !== 'function') throw new TypeError('Native RAW Originals requires actual Main owners and captured capabilities.');
   const load = catalog.loadPhoto, read = originals.withOriginal;
   if (typeof load !== 'function' || typeof read !== 'function') throw new TypeError('Native RAW Originals requires complete actual read methods.');
   owner.#load = (...args) => Reflect.apply(load, catalog, args) as ReturnType<Catalog['loadPhoto']>;
   owner.#read = <Value>(request: Parameters<Originals['withOriginal']>[0], consume: (view: ReaderView) => Value | PromiseLike<Value>, options?: Options) =>
    Reflect.apply(read, originals, [request, consume, options]) as Promise<Value>;
   owner.#prepare = options => Reflect.apply(prepare, value, [options]) as ReturnType<LightscaperNativePhotoRawOriginalsOptionsCurrentV1['prepare']>;
   owner.#assertScope = () => { Reflect.apply(assert, selected, []); };
   owner.#unretired = () => { Reflect.apply(unretired, value, []); };
   owner.#currentScope(); return owner;
  } catch (caught) {
   let primary = caught; try { check(owner.#signal); } catch (reason) { primary = reason; }
   try { owner.#detach(); } catch (cleanup) { owner.#quarantine(cleanup); throw new AggregateError([primary, cleanup], 'Native RAW Originals opening and signal retirement failed.', { cause: cleanup }); }
   throw primary;
  }
 }
 #currentScope(): void { if (this.#stopped || this.#closing || this.#cleanup.size) throw new Error('Native RAW Originals owner is stopped or quarantined.'); check(this.#signal); this.#assertScope(); check(this.#signal); }
 #admit<Value>(value: unknown, consume: (view: Readonly<Frame> | Readonly<Preview>) => Value | Promise<Value>, options: Options = {}, preview: boolean): Promise<Result<Value>> {
  try { this.#currentScope(); if (active || quarantined.size) throw new Error('The native RAW Originals lane is busy or quarantined.'); }
  catch (error) { return Promise.reject(error); }
  const token = Object.freeze({}); active = token;
  let resolve!: (value: Result<Value>) => void, reject!: (error: unknown) => void;
  const work = new Promise<Result<Value>>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active = work;
  let selected: ReturnType<typeof link> | undefined, signal = this.#signal;
  const finish = (outcome: { value: Result<Value> } | { error: unknown }): void => {
   try { selected?.detach(); } catch (cleanup) { this.#quarantine(cleanup); }
   if (this.#active === work) this.#active = undefined;
   if (this.#cleanup.size) { reject(new AggregateError([...('error' in outcome ? [outcome.error] : []), ...this.#cleanup], 'Native RAW Original retirement is unproved.')); return; }
   this.#held.clear(); if (active === token) active = undefined;
   if ('error' in outcome) reject(outcome.error); else resolve(outcome.value);
  };
  try {
   const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
   const caller: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
   if (caller !== undefined) assertPhotoStackQuerySignalV1(caller); selected = link(caller as AbortSignal | undefined, signal); signal = selected.signal;
   const config = record(options, 'native RAW Originals call options', ['signal'], []);
   if ((Object.hasOwn(config, 'signal') ? field(config, 'signal', 'native RAW Originals call options') : undefined) !== caller) throw new TypeError('Native RAW cancellation changed during admission.');
   check(signal); const request = preview ? previewRequest(value) : frameRequest(value); if (typeof consume !== 'function') throw new TypeError('Native RAW requires its scoped consumer.');
   check(signal); this.#held.add(request); this.#held.add(consume);
   void Promise.resolve().then(() => this.#run(request, consume, signal)).then(result => { finish({ value: result }); }, (caught: unknown) => {
    let primary = caught; try { check(signal); } catch (reason) { primary = reason; } finish({ error: primary });
   });
  } catch (caught) { let primary = caught; try { check(signal); } catch (reason) { primary = reason; } finish({ error: primary }); }
  return work;
 }
 async #current(request: Readonly<Authority>, signal: AbortSignal): Promise<void> {
  check(signal); this.#currentScope(); const raw = await this.#load(request.catalogId, request.photoId); check(signal); this.#currentScope();
  if (!raw) throw new ReferenceError('Native RAW Photo is missing.'); const photo = normalizePhotoDocumentCurrentV1(raw);
  if (photo.catalogId !== request.catalogId || photo.id !== request.photoId || JSON.stringify(photo.original) !== JSON.stringify(request.original)) throw new PhotoCatalogRevisionConflictError('photo');
  if (request.expectedRevision !== null && photo.revision !== request.expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
 }
 async #run<Value>(request: Readonly<Authority>, consume: (view: Readonly<Frame> | Readonly<Preview>) => Value | Promise<Value>, signal: AbortSignal): Promise<Result<Value>> {
  await this.#current(request, signal);
  let outcome: { value: Result<Value> } | { error: unknown } | undefined;
  try {
   await this.#read({ catalogId: request.catalogId, photoId: request.photoId, original: request.original }, async reader => {
    // All consumer/launch failures stay data here. A genuine Reader cleanup
    // failure remains distinguishable from a borrower-thrown AggregateError.
    try {
     await this.#current(request, signal);
     if (!['image/x-adobe-dng', 'image/x-canon-crw'].includes(request.original.mimeType ?? '') || request.original.byteLength > 64 * 1024 * 1024) {
      outcome = { value: Object.freeze({ outcome: 'web-fallback', reason: 'unsupported-representation' }) }; return;
     }
     if ('tier' in request) {
      // First full neutral validation authenticates stored geometry; its real
      // plane/peer retire before the separate native preview job starts.
      const validated = await this.#decode(request, reader, 'canonical', null, () => undefined, signal);
      if (validated.outcome === 'web-fallback') { outcome = { value: validated }; return; }
      outcome = { value: await this.#decode(request, reader, 'canonical', request.tier, consume, signal) };
     } else outcome = { value: await this.#decode(request, reader, request.profile, null, consume, signal) };
    } catch (error) { outcome = { error }; }
   }, { signal });
  } catch (error) {
   let cancelled = false; try { check(signal); } catch (reason) { cancelled = Object.is(reason, error); }
   if (!cancelled && types.isNativeError(error) && Object.getOwnPropertyDescriptor(error, 'errors') !== undefined) this.#quarantine(error);
   if (outcome && 'error' in outcome && !Object.is(outcome.error, error)) throw new AggregateError([outcome.error, error], 'Native RAW work and actual Original retirement failed.', { cause: error });
   throw error;
  }
  if (!outcome) throw new Error('Native RAW Original reader has no terminal outcome.');
  if ('error' in outcome) throw outcome.error;
  await this.#current(request, signal); return outcome.value;
 }
 async #decode<Value>(request: Readonly<Authority>, reader: ReaderView, profile: Profile, tier: null | 'thumbnail' | 'fit-screen',
  consume: (view: Readonly<Frame> | Readonly<Preview>) => Value | Promise<Value>, signal: AbortSignal): Promise<Result<Value>> {
  await this.#current(request, signal); const prepared = await this.#prepare(Object.freeze({ signal }));
  if (!prepared) { await this.#current(request, signal); return Object.freeze({ outcome: 'web-fallback', reason: 'native-unavailable' }); }
  this.#held.add(prepared); let start: unknown, close: unknown;
  try {
   const startDescriptor = Object.getOwnPropertyDescriptor(prepared, 'start'), closeDescriptor = Object.getOwnPropertyDescriptor(prepared, 'close');
   start = startDescriptor && Object.hasOwn(startDescriptor, 'value') ? startDescriptor.value : undefined;
   close = closeDescriptor && Object.hasOwn(closeDescriptor, 'value') ? closeDescriptor.value : undefined;
   if (typeof start !== 'function' || typeof close !== 'function') throw new TypeError('Trusted RAW preparation returned no own actual retirement methods.');
  } catch (error) { this.#quarantine(error); throw error; }
  const capturedStart = start, capturedClose = close;
  let raw: Raw | undefined, outcome: { value: Result<Value> } | { error: unknown };
  try {
   await this.#current(request, signal);
   raw = Raw.create({ start: () => Reflect.apply(capturedStart, prepared, []) as ChildProcessWithoutNullStreams, retire: async () => { await Reflect.apply(capturedClose, prepared, []); }, signal, unretired: () => { this.#quarantine(new Error('Actual native RAW role retirement is unproved.')); } }); this.#held.add(raw);
   const read = reader.read;
   const result = await raw.withDecoded({ mode: profile === 'canonical' ? 'neutral' : profile === 'linear-headroom-v1' ? 'linear-headroom' : 'highlight-recovery', tier,
    source: { byteLength: request.original.byteLength, contentSha256: request.original.contentSha256,
     read: (offset: number, length: number, options: Options) => Reflect.apply(read, reader, [offset, length, options]) as Promise<Uint8Array> } }, async decoded => {
     await this.#current(request, signal); const view = convert(decoded, request, profile, tier);
     const result = await consume(view); check(signal); await this.#current(request, signal);
     return Object.freeze({ outcome: 'native' as const, value: result });
    }, { signal }); outcome = { value: result };
  } catch (error) { outcome = { error }; }
  const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
  if (raw) { try { await raw.close(); } catch (error) { failures.push(error); this.#quarantine(error); } }
  try { await Reflect.apply(capturedClose, prepared, []); } catch (error) { failures.push(error); this.#quarantine(error); }
  if (!this.#cleanup.size) { this.#held.delete(prepared); if (raw) this.#held.delete(raw); }
  if (failures.length === 1) throw failures[0]; if (failures.length > 1) throw new AggregateError(failures, 'Native RAW decode and actual prepared child retirement failed.', { cause: failures[0] });
  if ('value' in outcome) return outcome.value; throw new Error('Native RAW has no decoded outcome.');
 }
 #quarantine(error: unknown): void {
  this.#cleanup.add(error); quarantined.add(this); if (this.#notified) return; this.#notified = true;
  try { this.#unretired(); } catch (secondary) { this.#cleanup.add(secondary); }
 }
 #stopOwner(): void { if (this.#stopped) return; this.#stopped = true; try { Reflect.apply(ABORT, this.#stop, [new DOMException('Native RAW Originals stopped.', 'AbortError')]); } catch (error) { this.#quarantine(error); } }
 readonly stop = (): void => { this.#stopOwner(); };
 close(): Promise<void> {
  if (this.#closing) return this.#closing;
  let resolve!: () => void, reject!: (error: unknown) => void; this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
  const work = this.#active; this.#stopOwner();
  void Promise.allSettled(work ? [work] : []).then(() => {
   try { this.#detach(); } catch (error) { this.#quarantine(error); }
   if (this.#cleanup.size) throw new AggregateError([...this.#cleanup], 'Native RAW Originals actual retirement is unproved.');
  }).then(resolve, reject); return this.#closing;
 }
}
function convert(decoded: Readonly<Decoded>, request: Readonly<Authority>, profile: Profile, tier: null | 'thumbnail' | 'fit-screen'): Readonly<Frame> | Readonly<Preview> {
 const pixels = decoded.format === 'rgba16le' ? new Uint16Array(decoded.bytes.buffer) : decoded.format === 'rgba32fle' ? new Float32Array(decoded.bytes.buffer) : decoded.bytes;
 const decoder = { schemaVersion: 1, engine: 'lightscaper-libraw-native', engineVersion: 1, upstream: '0.22.2',
  profile: profile === 'canonical' ? 'neutral-linear-srgb16' : profile === 'linear-headroom-v1' ? 'linear-headroom-f32' : 'highlight-recovery-f32', profileVersion: 1 };
 const value = { decoder, profile, frame: { descriptor: { schemaVersion: 1, width: decoded.width, height: decoded.height,
  sampleFormat: tier === null ? profile === 'canonical' ? 'unorm16' : 'float32' : 'unorm8', primaries: 'srgb', transfer: tier === null ? 'linear' : 'srgb' }, pixels },
  rawFlip: decoded.rawFlip, exposureScale: decoded.exposureScale, contentSha256: decoded.contentSha256 };
 const base = { catalogId: request.catalogId, photoId: request.photoId, original: request.original };
 return tier === null ? frameView(value, { ...base, expectedRevision: request.expectedRevision, profile }) : previewView({ ...value,
  source: { width: request.original.width, height: request.original.height }, recipe: { id: 'lightscaper.native-original-preview.rgba8-nearest', version: 1 } }, { ...base, expectedRevision: null, tier });
}

/** Captures only the originally issued facade of an actual Main owner. Public
 * property replacement, proxies and prototype inheritance grant no authority. */
export function captureLightscaperNativePhotoRawOriginalsCurrentV1(value: unknown): Readonly<Source> {
 const facet = typeof value === 'object' && value !== null ? ISSUED.get(value) : undefined;
 if (!facet) throw new TypeError('Native RAW tickets require their genuine Main source owner.');
 return facet;
}
