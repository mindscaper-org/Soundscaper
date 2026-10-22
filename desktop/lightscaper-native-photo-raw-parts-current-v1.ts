/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { LightscaperNativePhotoRawOriginalsCurrentV1 as Originals, type LightscaperNativePhotoRawOriginalsOptionsCurrentV1 as Options } from './lightscaper-native-photo-raw-originals-current-v1.ts';
import { LightscaperNativePhotoRawTicketsCurrentV1 as Tickets } from './lightscaper-native-photo-raw-tickets-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check, linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import type { DesktopPhotoRawTransportCurrentV1 as Transport } from '../src/lightscaper/desktop-photo-raw-contract-current-v1.ts';
type Scope = Options['scope'];
export interface LightscaperNativePhotoRawPartsFacetCurrentV1 {
 readonly prepare: Options['prepare']; readonly scope: Scope; readonly transport: Readonly<Transport>; readonly unretired: () => void;
}
const ISSUED = new WeakMap<object, Readonly<LightscaperNativePhotoRawPartsFacetCurrentV1>>();
const QUARANTINED = new Set<object>();
const ABORT = AbortController.prototype.abort;

/** Main component owner. Capture the real Catalog/Reader before vending;
 * ticket construction is lazy, but never recaptures those borrowed methods. */
export class LightscaperNativePhotoRawPartsCurrentV1 {
 readonly transport: Readonly<Transport>;
 readonly #stop = new AbortController(); readonly #cleanup = new Set<unknown>();
 #scope!: Scope; #detach: () => void = () => undefined; #notify: () => void = () => undefined;
 #native!: Originals; #nativeClose!: () => Promise<void>;
 #ticketClose: (() => Promise<void>) | undefined; #ticketTransport: Readonly<Transport> | undefined;
 #closed = false; #notified = false; #closing: Promise<void> | undefined;
 private constructor() {
  this.transport = Object.freeze<Transport>({
   open: (request, options) => { try { this.#current(); return this.#ticket().open(request, options); } catch (error) { return Promise.reject(error); } },
   read: (ticket, offset, length) => { try { this.#current(); if (!this.#ticketTransport) throw new ReferenceError('No stored RAW output was issued.'); return this.#ticketTransport.read(ticket, offset, length); } catch (error) { return Promise.reject(error); } },
   close: ticket => { try { if (!this.#ticketTransport) throw new ReferenceError('No stored RAW output was issued.'); return this.#ticketTransport.close(ticket); } catch (error) { return Promise.reject(error); } },
  });
 }
 static create(value: Options): LightscaperNativePhotoRawPartsCurrentV1 {
  const owner = new LightscaperNativePhotoRawPartsCurrentV1();
  try {
   const input = record(value, 'native RAW component options', ['catalog', 'originals', 'prepare', 'scope', 'unretired']);
   const selected = field(input, 'scope', 'native RAW component options'), scope = record(selected, 'native RAW component scope', ['signal', 'assertCurrent']);
   const signal = field(scope, 'signal', 'native RAW component scope'); assertPhotoStackQuerySignalV1(signal);
   const assert = field(scope, 'assertCurrent', 'native RAW component scope'), prepare = field(input, 'prepare', 'native RAW component options'), notify = field(input, 'unretired', 'native RAW component options');
   if (typeof assert !== 'function' || typeof prepare !== 'function' || typeof notify !== 'function') throw new TypeError('Native RAW component requires its captured Main capabilities.');
   owner.#notify = () => { Reflect.apply(notify, value, []); };
   const linked = link(signal, owner.#stop.signal); owner.#detach = linked.detach;
   const actualScope = Object.freeze<Scope>({ signal: linked.signal, assertCurrent: () => { if (owner.#closed || owner.#cleanup.size) throw new Error('Native RAW component is closed or quarantined.'); check(linked.signal); Reflect.apply(assert, selected, []); check(linked.signal); } });
   owner.#scope = actualScope;
   const capturedPrepare: Options['prepare'] = options => { owner.#current(); return Reflect.apply(prepare, value, [options]) as ReturnType<Options['prepare']>; };
   const nativeOptions: Options = { catalog: field(input, 'catalog', 'native RAW component options') as Options['catalog'], originals: field(input, 'originals', 'native RAW component options') as Options['originals'],
    prepare: capturedPrepare, scope: actualScope, unretired: () => { owner.#quarantine(new Error('Stored native RAW component retirement is unproved.')); } };
   const facet = Object.freeze<LightscaperNativePhotoRawPartsFacetCurrentV1>({ prepare: capturedPrepare, scope: actualScope, transport: owner.transport, unretired: () => { owner.#quarantine(new Error('Native RAW component child retirement is unproved.')); } });
   // This is the final fallible constructor: its own opening catch owns its
   // signal cleanup. No physical process or file has been acquired here.
   owner.#native = Originals.create(nativeOptions); const close = owner.#native.close;
   owner.#nativeClose = () => Reflect.apply(close, owner.#native, []) as Promise<void>;
   ISSUED.set(owner, facet); return owner;
  } catch (caught) {
   let primary = caught; try { check(owner.#scope?.signal ?? owner.#stop.signal); } catch (reason) { primary = reason; }
   try { owner.#detach(); } catch (cleanup) { owner.#quarantine(cleanup); throw new AggregateError([primary, cleanup], 'Native RAW component admission and signal retirement failed.', { cause: cleanup }); } throw primary;
  }
 }
 #current(): void { if (this.#closed || this.#cleanup.size) throw new Error('Native RAW component is closed or quarantined.'); this.#scope.assertCurrent(); }
 #ticket(): Readonly<Transport> {
  if (this.#ticketTransport) return this.#ticketTransport;
  const tickets = Tickets.create({ native: this.#native, scope: this.#scope, unretired: () => { this.#quarantine(new Error('Stored native RAW ticket retirement is unproved.')); } });
  const close = tickets.close; this.#ticketClose = () => Reflect.apply(close, tickets, []) as Promise<void>;
  const transport = tickets.transport, open = transport.open, read = transport.read, retire = transport.close; this.#ticketTransport = Object.freeze<Transport>({ open: (request, options) => Reflect.apply(open, transport, [request, options]) as ReturnType<Transport['open']>,
   read: (ticket, offset, length) => Reflect.apply(read, transport, [ticket, offset, length]) as ReturnType<Transport['read']>, close: ticket => Reflect.apply(retire, transport, [ticket]) as ReturnType<Transport['close']> });
  return this.#ticketTransport;
 }
 #quarantine(error: unknown): void { this.#cleanup.add(error); QUARANTINED.add(this); if (this.#notified) return; this.#notified = true; try { this.#notify(); } catch (secondary) { this.#cleanup.add(secondary); } }
 close(): Promise<void> {
  if (this.#closing) return this.#closing;
  let resolve!: () => void, reject!: (error: unknown) => void; this.#closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); this.#closed = true;
  try { Reflect.apply(ABORT, this.#stop, [new DOMException('Native RAW component closed.', 'AbortError')]); } catch (error) { this.#quarantine(error); }
  // Start both sides before joining: a published ticket owns the callback
  // which the underlying RAW owner must join.
  const tasks: Promise<void>[] = [];
  for (const close of [this.#ticketClose, this.#nativeClose]) if (close) try { tasks.push(close()); } catch (error) { this.#quarantine(error); }
  void Promise.allSettled(tasks).then(results => { for (const result of results) if (result.status === 'rejected') this.#quarantine(result.reason);
   try { this.#detach(); } catch (error) { this.#quarantine(error); }
   if (this.#cleanup.size) throw new AggregateError([...this.#cleanup], 'Native RAW component actual retirement is unproved.');
  }).then(resolve, reject); return this.#closing;
 }
}

/** Only the originally issued facet of this actual Main owner is authority. */
export function captureLightscaperNativePhotoRawPartsCurrentV1(value: unknown): Readonly<LightscaperNativePhotoRawPartsFacetCurrentV1> {
 const facet = typeof value === 'object' && value !== null ? ISSUED.get(value) : undefined;
 if (!facet) throw new TypeError('Native RAW gateway requires genuine component-owned RAW parts.'); return facet;
}
