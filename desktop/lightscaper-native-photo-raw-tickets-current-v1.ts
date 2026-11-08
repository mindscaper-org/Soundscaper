/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { captureLightscaperNativePhotoRawOriginalsCurrentV1 as capture } from './lightscaper-native-photo-raw-originals-current-v1.ts';
import { captureLightscaperNativePhotoRawInputsCurrentV1 as captureInputs } from './lightscaper-native-photo-raw-inputs-current-v1.ts';
import type { PhotoLibraryRawImportFrameCurrentV1 as InputFrame } from '../src/lightscaper/controller/photo-library-raw-import-current-v1.ts';
import { captureRepairSignalV1 } from '../src/common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { linkLightscaperNativePhotoMediaSignalsCurrentV1 as link, checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { readDesktopPhotoRawRequestCurrentV1 as requestOf, readDesktopPhotoRawTicketCurrentV1 as ticketOf, readDesktopPhotoRawTicketIdCurrentV1 as idOf,
	DESKTOP_PHOTO_RAW_LIMITS_CURRENT_V1 as LIMITS, type DesktopPhotoRawOpenCurrentV1 as Open, type DesktopPhotoRawTransportCurrentV1 as Transport,
	type DesktopPhotoRawRetirementCurrentV1 as Retirement } from '../src/lightscaper/desktop-photo-raw-contract-current-v1.ts';
import type { PhotoLibraryRawSourceCurrentV1 as Source, PhotoLibraryRawFrameCurrentV1 as Frame, PhotoLibraryRawPreviewCurrentV1 as Preview } from '../src/lightscaper/controller/photo-library-raw-source-current-v1.ts';
type Scope = Readonly<{ signal: AbortSignal; assertCurrent(): void }>;
interface Deferred<Value> { readonly promise: Promise<Value>; resolve(value: Value): void; reject(error: unknown): void }
function deferred<Value>(): Deferred<Value> { let resolve!: (value: Value) => void, reject!: (error: unknown) => void; const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
interface Entry {
	readonly controller: AbortController; signal: AbortSignal; detach: () => void;
	readonly reads: Set<Promise<unknown>>; readonly ready: Deferred<Open>; readonly release: Deferred<void>; terminal: Promise<void>;
	id: string | undefined; bytes: Uint8Array<ArrayBuffer> | undefined; busy: boolean; published: boolean; closing?: Promise<Retirement>;
}
const QUARANTINE = new Set<object>();
const ABORT = AbortController.prototype.abort;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'buffer')!.get!;

/** One Main output ticket retains the actual native source callback. Encoded
 * Original budgets and generic Session body budgets are independent of it. */
export class LightscaperNativePhotoRawTicketsCurrentV1 {
	readonly transport: Readonly<Transport>;
	readonly #raw: Readonly<Source> | undefined; readonly #inputs: ReturnType<typeof captureInputs> | undefined; readonly #scope: Scope; readonly #assert: Scope['assertCurrent']; readonly #unretired: () => void;
	#retired: Readonly<{ id: string; done: Promise<Retirement> }> | undefined;
	#entry: Entry | undefined; #closed = false; #closing: Promise<void> | undefined; #failure: unknown; #failed = false;
	private constructor(raw: Readonly<Source> | undefined, inputs: ReturnType<typeof captureInputs> | undefined, scope: Scope, unretired: () => void) {
		this.#raw = raw; this.#inputs = inputs; this.#scope = scope; this.#assert = scope.assertCurrent; this.#unretired = unretired;
		this.transport = Object.freeze<Transport>({ open: (value, options) => this.#open(value, options), read: (value, offset, length) => this.#read(value, offset, length), close: value => this.#wireClose(value) });
	}
	static create(value: Readonly<{ native?: unknown; inputs?: unknown; scope: Scope; unretired: () => void }>): LightscaperNativePhotoRawTicketsCurrentV1 {
		const input = record(value, 'Main RAW tickets', ['native', 'inputs', 'scope', 'unretired'], ['scope', 'unretired']);
		const raw = Object.hasOwn(input, 'native') ? capture(field(input, 'native', 'Main RAW tickets')) : undefined;
		const inputs = Object.hasOwn(input, 'inputs') ? captureInputs(field(input, 'inputs', 'Main RAW tickets')) : undefined;
		if (!raw && !inputs) throw new TypeError('Main RAW tickets require an actual stored or input source.');
		const scope = field(input, 'scope', 'Main RAW tickets') as Scope;
		const selected = record(scope, 'Main RAW ticket scope', ['signal', 'assertCurrent']); const scopeSignal = captureRepairSignalV1(field(selected, 'signal', 'Main RAW ticket scope'));
		if (!scopeSignal) throw new TypeError('Main RAW tickets require an actual scope signal.');
		const assert = field(selected, 'assertCurrent', 'Main RAW ticket scope'), unretired = field(input, 'unretired', 'Main RAW tickets');
		if (typeof assert !== 'function' || typeof unretired !== 'function') throw new TypeError('Main RAW tickets require actual scope and retirement owners.');
		const owner = new LightscaperNativePhotoRawTicketsCurrentV1(raw, inputs, { signal: scopeSignal, assertCurrent: () => { Reflect.apply(assert, scope, []); } }, () => { Reflect.apply(unretired, value, []); }); owner.#current(); return owner;
	}
	#current(): void { if (this.#closed || this.#failed) throw new Error('Main RAW output tickets are closed or quarantined.'); check(this.#scope.signal); Reflect.apply(this.#assert, this.#scope, []); check(this.#scope.signal); }
	#open(value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Open> {
		try { this.#current(); if (this.#entry) throw new RangeError('Main RAW output capacity is occupied.'); } catch (error) { return Promise.reject(error); }
		const terminal = deferred<void>(); void terminal.promise.catch(() => undefined);
		const controller = new AbortController(), entry: Entry = { controller, signal: controller.signal, detach: () => undefined, reads: new Set(), ready: deferred(), release: deferred(), terminal: terminal.promise, id: undefined, bytes: undefined, busy: false, published: false }; this.#entry = entry;
		try {
			const input = record(options, 'Main RAW output options', ['signal'], []), caller = Object.hasOwn(input, 'signal') ? captureRepairSignalV1(field(input, 'signal', 'Main RAW output options')) : undefined;
			const scope = link(this.#scope.signal, controller.signal); entry.detach = scope.detach; const selected = link(caller, scope.signal); entry.signal = selected.signal; entry.detach = () => { selected.detach(); scope.detach(); };
			check(entry.signal); const request = requestOf(value); check(entry.signal); this.#current();
			const consume = async (view: Readonly<Frame> | Readonly<Preview> | Readonly<InputFrame>): Promise<void> => {
				this.#current(); check(entry.signal); const id = randomBytes(32).toString('hex');
				const ticket = ticketOf({ schemaVersion: 1, id, byteLength: view.frame.pixels.byteLength, descriptor: view.frame.descriptor,
					decoder: view.decoder, profile: view.profile, rawFlip: view.rawFlip, exposureScale: view.exposureScale, contentSha256: view.contentSha256,
					...('input' in view ? { input: view.input } : {}),
					...('source' in view ? { source: view.source, recipe: view.recipe } : {}) }, request);
				entry.id = id; entry.bytes = new Uint8Array(Reflect.apply(BUFFER, view.frame.pixels, []) as ArrayBuffer); entry.published = true;
				entry.ready.resolve(Object.freeze({ outcome: 'ready', ticket })); await entry.release.promise;
			};
			const actual = Promise.resolve().then(async () => {
				check(entry.signal); this.#current();
				if (request.kind === 'input' ? !this.#inputs : !this.#raw) throw new Error('Native RAW output purpose is unavailable in this owner.');
				const outcome = request.kind === 'input' ? await this.#inputs!.withFrame(request.request.inputId, consume, { signal: entry.signal }) : request.kind === 'frame' ? await this.#raw!.withFrame(request.request, consume, { signal: entry.signal }) : await this.#raw!.withPreview(request.request, consume, { signal: entry.signal });
				if (outcome.outcome === 'web-fallback') { if (entry.published) throw new Error('Native fallback followed a published output.'); entry.ready.resolve(outcome); }
			}).catch((error: unknown) => {
				entry.ready.reject(error);
				if (!Object.is(error, entry.signal.reason) && types.isNativeError(error) && Object.getOwnPropertyDescriptor(error, 'errors')) this.#quarantine(error);
				throw error;
			}).finally(() => { if (!entry.published) { try { entry.detach(); } catch (error) { this.#quarantine(error); throw error; } if (!this.#failed && this.#entry === entry) this.#entry = undefined; } });
			void actual.then(() => { terminal.resolve(); }, terminal.reject);
		} catch (error) { entry.detach(); this.#entry = undefined; entry.ready.reject(error); terminal.reject(error); }
		return entry.ready.promise;
	}
	#read(value: unknown, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
		try {
			this.#current(); const entry = this.#entry; if (!entry || entry.closing || entry.busy || !entry.bytes) throw new Error('Native RAW output is unavailable or busy.'); entry.busy = true;
			try { const id = idOf(value); check(entry.signal);
				if (id !== entry.id || !Number.isSafeInteger(offset) || offset < 0 || Object.is(offset, -0) || !Number.isSafeInteger(length) || length < 1 || length > LIMITS.maximumRangeBytes || offset > entry.bytes.byteLength - length) throw new RangeError('Native RAW output range or identity is invalid.');
				const copied = entry.bytes.slice(offset, offset + length), work = Promise.resolve(copied).finally(() => { entry.busy = false; entry.reads.delete(work); }); entry.reads.add(work); return work;
			} catch (error) { entry.busy = false; throw error; }
		} catch (error) { return Promise.reject(error); }
	}
	#wireClose(value: unknown): Promise<Retirement> {
		try { const id = idOf(value), entry = this.#entry; if (entry?.id === id) return this.#retire(entry); if (this.#retired?.id === id) return this.#retired.done; throw new ReferenceError('Native RAW output identity was never issued by this owner.'); } catch (error) { return Promise.reject(error); }
	}
	#retire(entry: Entry): Promise<Retirement> {
		if (entry.closing) return entry.closing;
		entry.closing = Promise.resolve().then(async () => {
			await Promise.allSettled([...entry.reads]); entry.release.resolve();
			let sourceFailed = false;
			try { await entry.terminal; } catch (error) { if (this.#failed) throw error; sourceFailed = !Object.is(error, entry.signal.reason); }
			try { entry.detach(); } catch (error) { this.#quarantine(error); throw error; } entry.bytes = undefined; if (!this.#failed && this.#entry === entry) this.#entry = undefined;
			return sourceFailed ? Object.freeze({ retired: true as const, sourceFailed: true as const }) : undefined;
		}); if (entry.id) this.#retired = { id: entry.id, done: entry.closing }; return entry.closing;
	}
	#quarantine(error: unknown): void { if (this.#failed) return; this.#failed = true; this.#failure = error; QUARANTINE.add(this); try { this.#unretired(); } catch (secondary) { this.#failure = new AggregateError([error, secondary], 'Native RAW ticket cleanup is unproved.', { cause: error }); } }
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void; this.#closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); this.#closed = true;
		const entry = this.#entry; try { if (entry) Reflect.apply(ABORT, entry.controller, [new DOMException('Native RAW output owner closed.', 'AbortError')]); } catch (error) { this.#quarantine(error); }
		void Promise.resolve().then(async () => { if (entry) await this.#retire(entry); if (this.#failed) throw this.#failure; }).then(resolve, reject); return this.#closing;
	}
}
