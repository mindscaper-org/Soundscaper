/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { captureRepairSignalV1 } from '../src/common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { readDesktopPhotoRawRequestCurrentV1 as requestOf, readDesktopPhotoRawTicketIdCurrentV1 as idOf,
 type DesktopPhotoRawTransportCurrentV1 as Transport, type DesktopPhotoRawOpenCurrentV1 as Open,
 type DesktopPhotoRawRetirementCurrentV1 as Retirement } from '../src/lightscaper/desktop-photo-raw-contract-current-v1.ts';
import { captureLightscaperNativePhotoRawPartsCurrentV1 as captureParts } from './lightscaper-native-photo-raw-parts-current-v1.ts';
import { LightscaperNativePhotoSessionRawInputsCurrentV1 as Registry } from './lightscaper-native-photo-session-raw-inputs-current-v1.ts';
import { LightscaperNativePhotoRawInputsCurrentV1 as Inputs } from './lightscaper-native-photo-raw-inputs-current-v1.ts';
import { LightscaperNativePhotoRawTicketsCurrentV1 as Tickets } from './lightscaper-native-photo-raw-tickets-current-v1.ts';
import { LightscaperNativePhotoSessionHandlesCurrentV1 as Handles } from './lightscaper-native-photo-session-handles-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check, linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import type { LightscaperNativePhotoLinkedSessionCurrentV1 as Linked } from './lightscaper-native-photo-linked-session-current-v1.ts';
import type { LightscaperNativePhotoLinkedInputViewCurrentV1 as LinkedView } from './lightscaper-native-photo-linked-input-current-v1.ts';
type Scope = Readonly<{ signal: AbortSignal; assertCurrent(): void }>;
type Options = Readonly<{ signal?: AbortSignal }>;
type Booking = ReturnType<Handles['reserve']>;
interface Opening {
 readonly promise: Promise<Open>; readonly reads: Set<Promise<unknown>>;
 detach(): void; route?: Readonly<Transport>; id?: string; busy: boolean; closing?: Promise<Retirement>;
}
const ABORT = AbortController.prototype.abort;
const QUARANTINED = new Set<object>();

/** Main Session routing over genuine component storage and genuine completed
 * input proofs. It owns input children, while stored RAW Parts stay under the
 * component lifetime. No source descriptors become input-file authority. */
export class LightscaperNativePhotoSessionRawCurrentV1 {
 readonly transport: Readonly<Transport>;
 readonly #stop = new AbortController(); readonly #cleanup = new Set<unknown>();
 #parts!: ReturnType<typeof captureParts>; #registry!: Registry; #registryClose!: () => Promise<void>;
 #scope!: Scope; #detach: () => void = () => undefined;
 #inputs: Inputs | undefined; #inputsClose: (() => Promise<void>) | undefined;
 #ticketClose: (() => Promise<void>) | undefined; #inputTransport: Readonly<Transport> | undefined;
 #entry: Opening | undefined; #retired: Readonly<{ id: string; done: Promise<Retirement> }> | undefined;
 #closed = false; #notified = false; #closing: Promise<void> | undefined;
 private constructor() {
  this.transport = Object.freeze<Transport>({ open: (value, options) => this.#open(value, options),
   read: (value, offset, length) => this.#read(value, offset, length), close: value => this.#wireClose(value) });
 }
 static create(value: Readonly<{ lease: Readonly<{ components: Readonly<{ media: unknown; rawParts?: unknown }> }>; handles: Handles; linked?: Linked }>): LightscaperNativePhotoSessionRawCurrentV1 {
  const owner = new LightscaperNativePhotoSessionRawCurrentV1();
  try {
   const input = record(value, 'Main RAW gateway', ['lease', 'handles', 'linked'], ['lease', 'handles']);
   const lease = field(input, 'lease', 'Main RAW gateway');
   if (typeof lease !== 'object' || lease === null) throw new TypeError('Main RAW gateway requires its actual selected lease.');
   const components: unknown = Reflect.get(lease, 'components');
   if (typeof components !== 'object' || components === null) throw new TypeError('Main RAW gateway requires actual selected components.');
   owner.#parts = captureParts(Reflect.get(components, 'rawParts'));
   const handles = field(input, 'handles', 'Main RAW gateway'); if (!(handles instanceof Handles)) throw new TypeError('Main RAW gateway requires the actual Session handle registry.');
   const linked = Object.hasOwn(input, 'linked') ? field(input, 'linked', 'Main RAW gateway') : undefined;
   const borrow: unknown = linked === undefined ? undefined : linked !== null && typeof linked === 'object' ? Reflect.get(linked, 'withInput') : undefined;
   if (linked !== undefined && typeof borrow !== 'function') throw new TypeError('Main RAW gateway requires a captured actual linked input borrower.');
   const selected = link(owner.#parts.scope.signal, owner.#stop.signal); owner.#detach = selected.detach;
   owner.#scope = Object.freeze<Scope>({ signal: selected.signal, assertCurrent: () => { owner.#current(); } });
   const registry = Registry.create({ media: Reflect.get(components, 'media'), handles, scope: owner.#scope,
    unretired: () => { owner.#quarantine(new Error('Main RAW input registry retirement is unproved.')); },
    ...(typeof borrow === 'function' ? { withLinkedInput: (id: string, consume: Parameters<Registry['withInput']>[1], options?: Options) => Reflect.apply(borrow, linked,
     [Object.freeze({ kind: 'linked-input', id }), (source: Readonly<LinkedView>) => {
      // Project only the genuine borrowed byte capability. Its outer owner
      // still joins this consumer and every actual read before retirement.
      const read = source.read;
      return consume(Object.freeze({ byteLength: source.byteLength, contentSha256: source.contentSha256,
       read: (offset: number, length: number) => Reflect.apply(read, source, [offset, length]) as Promise<Uint8Array> }));
     }, options]) as Promise<unknown> } : {}) });
   owner.#registry = registry; const close = registry.close; owner.#registryClose = () => Reflect.apply(close, registry, []) as Promise<void>;
   return owner;
  } catch (caught) {
   let primary = caught; try { check(owner.#scope?.signal ?? owner.#stop.signal); } catch (reason) { primary = reason; }
   try { owner.#detach(); } catch (cleanup) { owner.#quarantine(cleanup); throw new AggregateError([primary, cleanup], 'Main RAW gateway admission and signal retirement failed.', { cause: cleanup }); } throw primary;
  }
 }
 #current(): void { if (this.#closed || this.#cleanup.size) throw new Error('Main RAW gateway is closed or quarantined.'); check(this.#scope?.signal ?? this.#stop.signal); this.#parts.scope.assertCurrent(); check(this.#scope?.signal ?? this.#stop.signal); }
 #input(): Readonly<Transport> {
  if (this.#inputTransport) return this.#inputTransport;
  if (!this.#inputs) {
   const registry = this.#registry, borrow = registry.withInput;
   const inputs = Inputs.create({ prepare: this.#parts.prepare, scope: this.#scope,
    withInput: (id, consume, options) => Reflect.apply(borrow, registry, [id, consume, options]) as Promise<unknown>,
    unretired: () => { this.#quarantine(new Error('Main RAW input source retirement is unproved.')); } });
   this.#inputs = inputs; const close = inputs.close; this.#inputsClose = () => Reflect.apply(close, inputs, []) as Promise<void>;
  }
  const tickets = Tickets.create({ inputs: this.#inputs, scope: this.#scope, unretired: () => { this.#quarantine(new Error('Main RAW input ticket retirement is unproved.')); } });
  const close = tickets.close; this.#ticketClose = () => Reflect.apply(close, tickets, []) as Promise<void>;
  const transport = tickets.transport, open = transport.open, read = transport.read, retire = transport.close;
  this.#inputTransport = Object.freeze<Transport>({ open: (request, options) => Reflect.apply(open, transport, [request, options]) as ReturnType<Transport['open']>,
   read: (ticket, offset, length) => Reflect.apply(read, transport, [ticket, offset, length]) as ReturnType<Transport['read']>, close: ticket => Reflect.apply(retire, transport, [ticket]) as ReturnType<Transport['close']> });
  return this.#inputTransport;
 }
 executeInput(packet: unknown, signal: AbortSignal, booking?: Booking): Promise<unknown> {
  try { this.#current(); return this.#registry.execute(packet, signal, booking); } catch (error) { booking?.abandon(); return Promise.reject(error); }
 }
 #open(value: unknown, options: Options = {}): Promise<Open> {
  try { this.#current(); if (this.#entry) throw new RangeError('Main RAW gateway output capacity is occupied.'); } catch (error) { return Promise.reject(error); }
  let resolve!: (value: Open) => void, reject!: (error: unknown) => void;
  const work = new Promise<Open>((yes, no) => { resolve = yes; reject = no; });
  const entry: Opening = { promise: work, reads: new Set(), detach: () => undefined, busy: false }; this.#entry = entry;
  let signal = this.#scope.signal;
  try {
   const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
   const caller: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
   const actualCaller = caller === undefined ? undefined : captureRepairSignalV1(caller);
   const selected = link(actualCaller, signal); signal = selected.signal; entry.detach = selected.detach;
   const config = record(options, 'Main RAW gateway options', ['signal'], []);
   if ((Object.hasOwn(config, 'signal') ? field(config, 'signal', 'Main RAW gateway options') : undefined) !== caller) throw new TypeError('Main RAW gateway cancellation changed during admission.');
   check(signal); const request = requestOf(value); check(signal); this.#current();
   const route = request.kind === 'input' ? this.#input() : this.#parts.transport; entry.route = route;
   void Promise.resolve().then(async () => {
    check(signal); this.#current(); const opened = await route.open(request, { signal });
    if (opened.outcome === 'ready') entry.id = opened.ticket.id;
    try { check(signal); this.#current(); }
    catch (primary) {
     if (entry.id) {
      let retired: Retirement;
      try { retired = await route.close({ id: entry.id }); } catch (cleanup) { this.#quarantine(cleanup); throw new AggregateError([primary, cleanup], 'Cancelled RAW output and actual ticket retirement failed.', { cause: cleanup }); }
      if (!entry.closing) this.#retired = { id: entry.id, done: Promise.resolve(retired) };
     }
     this.#finish(entry); throw primary;
    }
    if (opened.outcome === 'web-fallback') this.#finish(entry); return opened;
   }).then(resolve, (caught: unknown) => {
    let primary = caught; if (!this.#cleanup.size) try { check(signal); } catch (reason) { primary = reason; }
    if (!entry.id) try { this.#finish(entry); } catch (cleanup) { this.#quarantine(cleanup); primary = new AggregateError([primary, cleanup], 'RAW gateway admission and signal retirement failed.', { cause: cleanup }); }
    reject(primary);
   });
  } catch (caught) {
   let primary = caught; try { check(signal); } catch (reason) { primary = reason; }
   try { this.#finish(entry); } catch (cleanup) { this.#quarantine(cleanup); primary = new AggregateError([primary, cleanup], 'RAW gateway capture and signal retirement failed.', { cause: cleanup }); } reject(primary);
  } return work;
 }
 #read(value: unknown, offset: number, length: number): ReturnType<Transport['read']> {
  try {
   this.#current(); const entry = this.#entry;
   if (!entry?.id || !entry.route || entry.closing || entry.busy) throw new Error('Main RAW gateway output is missing or busy.'); entry.busy = true;
   try {
    const id = idOf(value); if (id !== entry.id) throw new ReferenceError('RAW output belongs to a different gateway ticket.'); this.#current();
    const route = entry.route, work = Promise.resolve().then(() => route.read({ id }, offset, length)); entry.reads.add(work);
    void work.then(() => { entry.reads.delete(work); entry.busy = false; }, () => { entry.reads.delete(work); entry.busy = false; }); return work;
   } catch (error) { entry.busy = false; throw error; }
  } catch (error) { return Promise.reject(error); }
 }
 #wireClose(value: unknown): Promise<Retirement> {
  try { const id = idOf(value); if (this.#entry?.id === id) return this.#retire(this.#entry); if (this.#retired?.id === id) return this.#retired.done; throw new ReferenceError('RAW output was never issued by this gateway.'); }
  catch (error) { return Promise.reject(error); }
 }
 #retire(entry: Opening): Promise<Retirement> {
  if (entry.closing) return entry.closing;
  let resolve!: (value: Retirement) => void, reject!: (error: unknown) => void;
  entry.closing = new Promise<Retirement>((yes, no) => { resolve = yes; reject = no; });
  const done = entry.closing;
  if (entry.id) this.#retired = { id: entry.id, done };
  void Promise.resolve().then(async () => {
   await Promise.allSettled([entry.promise, ...entry.reads]);
   let result: Retirement = undefined;
   if (entry.id && entry.route) {
    this.#retired = { id: entry.id, done };
    try { result = await entry.route.close({ id: entry.id }); } catch (error) { this.#quarantine(error); throw error; }
   }
   this.#finish(entry); return result;
  }).then(resolve, error => { this.#quarantine(error); reject(error); }); return entry.closing;
 }
 #finish(entry: Opening): void { entry.detach(); if (!this.#cleanup.size && this.#entry === entry) this.#entry = undefined; }
 #quarantine(error: unknown): void { this.#cleanup.add(error); QUARANTINED.add(this); this.#closed = true; if (this.#notified) return; this.#notified = true; try { this.#parts?.unretired(); } catch (secondary) { this.#cleanup.add(secondary); } }
 close(): Promise<void> {
  if (this.#closing) return this.#closing;
  let resolve!: () => void, reject!: (error: unknown) => void; this.#closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); this.#closed = true;
  try { Reflect.apply(ABORT, this.#stop, [new DOMException('Main RAW Session gateway closed.', 'AbortError')]); } catch (error) { this.#quarantine(error); }
  const entry = this.#entry, started: Promise<unknown>[] = [];
  try { if (this.#ticketClose) started.push(this.#ticketClose()); } catch (error) { this.#quarantine(error); }
  if (entry) started.push(this.#retire(entry));
  void Promise.allSettled(started).then(async results => {
   for (const result of results) if (result.status === 'rejected') this.#quarantine(result.reason);
   for (const close of [this.#inputsClose, this.#registryClose]) if (close) try { await close(); } catch (error) { this.#quarantine(error); }
   try { this.#detach(); } catch (error) { this.#quarantine(error); }
   if (this.#cleanup.size) throw new AggregateError([...this.#cleanup], 'Main RAW gateway actual retirement is unproved.');
  }).then(resolve, reject); return this.#closing;
 }
}
