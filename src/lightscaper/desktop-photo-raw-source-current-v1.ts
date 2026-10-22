/* SPDX-License-Identifier: AGPL-3.0-only */
import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import { readPhotoLibraryRawImportRequestCurrentV1 as importOf, type PhotoLibraryRawImportSourceCurrentV1 as ImportSource, type PhotoLibraryRawImportFrameCurrentV1 as InputFrame } from './controller/photo-library-raw-import-current-v1.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { captureRepairSignalV1, checkRepairSignalV1 as check } from '../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { readDesktopPhotoRawTicketIdCurrentV1 as idOf, readDesktopPhotoRawRequestCurrentV1 as requestOf, readDesktopPhotoRawOpenCurrentV1 as openOf, readDesktopPhotoRawRetirementCurrentV1 as retiredOf, DESKTOP_PHOTO_RAW_LIMITS_CURRENT_V1 as LIMITS,
	type DesktopPhotoRawTransportCurrentV1 as Transport, type DesktopPhotoRawRequestCurrentV1 as Request } from './desktop-photo-raw-contract-current-v1.ts';
import { readPhotoLibraryRawImportFrameCurrentV1 as inputFrameOf, readPhotoLibraryRawFrameCurrentV1 as frameOf, readPhotoLibraryRawPreviewCurrentV1 as previewOf,
	type PhotoLibraryRawFrameCurrentV1 as Frame, type PhotoLibraryRawPreviewCurrentV1 as Preview, type PhotoLibraryRawSourceCurrentV1 as Source,
	type PhotoLibraryRawResultCurrentV1 as Result } from './controller/photo-library-raw-source-current-v1.ts';
import { copyDesktopPhotoBytesCurrentV1 as copy } from './desktop-photo-library-session-transfer-client-current-v1.ts';
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill;
const ABORT = AbortController.prototype.abort;
let active: object | undefined;
const QUARANTINE = new Set<object>();

/** Renderer-owned dedicated output plane. The complete SHA is checked before
 * any consumer; the Main ticket remains held through callback and wiping. */
export class DesktopPhotoRawSourceCurrentV1 {
	readonly #transport: Readonly<Transport>; readonly #stop = new AbortController(); readonly #signal: AbortSignal;
	#active: Promise<unknown> | undefined; #closed = false; #closing: Promise<void> | undefined; #failure: unknown; #failed = false;
	readonly raw: Readonly<Source> = Object.freeze<Source>({
		withFrame: (request, consume, options) => this.#admit(() => ({ request: requestOf({ kind: 'frame', request }) }), consume, options),
		withPreview: (request, consume, options) => this.#admit(() => ({ request: requestOf({ kind: 'preview', request }) }), view => consume(view as Preview), options),
	});
	constructor(transport: Readonly<Transport>, options: Readonly<{ signal?: AbortSignal }> = {}) {
		const input = record(options, 'renderer RAW owner options', ['signal'], []), signal = Object.hasOwn(input, 'signal') ? captureRepairSignalV1(field(input, 'signal', 'renderer RAW owner options')) : undefined;
		this.#signal = signal ? AbortSignal.any([signal, this.#stop.signal]) : this.#stop.signal;
		const open = transport.open, read = transport.read, close = transport.close;
		if (typeof open !== 'function' || typeof read !== 'function' || typeof close !== 'function') throw new TypeError('Renderer RAW requires the installed output transport.');
		this.#transport = Object.freeze<Transport>({ open: (...args) => Reflect.apply(open, transport, args) as ReturnType<Transport['open']>,
			read: (...args) => Reflect.apply(read, transport, args) as ReturnType<Transport['read']>, close: (...args) => Reflect.apply(close, transport, args) as ReturnType<Transport['close']> });
	}
	forInput(value: string): Readonly<ImportSource> {
		const inputId = idOf({ id: value });
		return Object.freeze<ImportSource>({ withFrame: (borrowed, consume, options) => this.#admit(() => {
			const selected = importOf(borrowed);
			return { request: requestOf({ kind: 'input', request: { inputId, byteLength: selected.body.size, contentSha256: selected.contentSha256 } }), body: selected.body };
		}, view => consume(view as InputFrame), options) });
	}
	#admit<Value>(capture: () => Readonly<{ request: Request; body?: Blob }>, consume: (view: Readonly<Frame> | Readonly<Preview> | Readonly<InputFrame>) => Value | Promise<Value>, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Result<Value>> {
		try { if (this.#closed || active || QUARANTINE.size) throw new Error('Renderer RAW output capacity is closed, occupied or quarantined.'); check(this.#signal); } catch (error) { return Promise.reject(error); }
		const token = Object.freeze({}); active = token;
		let resolve!: (result: Result<Value>) => void, reject!: (error: unknown) => void;
		const work = new Promise<Result<Value>>((yes, no) => { resolve = yes; reject = no; }); this.#active = work;
		const finish = () => { if (!this.#failed) { if (active === token) active = undefined; this.#active = undefined; } };
		try {
			const input = record(options, 'renderer RAW call options', ['signal'], []), caller = Object.hasOwn(input, 'signal') ? captureRepairSignalV1(field(input, 'signal', 'renderer RAW call options')) : undefined;
			const signal = caller ? AbortSignal.any([caller, this.#signal]) : this.#signal; check(signal);
			const captured = capture(); if (typeof consume !== 'function') throw new TypeError('Renderer RAW requires its scoped consumer.');
			void this.#run(captured.request, consume, signal, captured.body).then(result => { finish(); resolve(result); }, (error: unknown) => { finish(); reject(error); });
		} catch (error) { finish(); reject(error); }
		return work;
	}
	async #run<Value>(request: Request, consume: (view: Readonly<Frame> | Readonly<Preview> | Readonly<InputFrame>) => Value | Promise<Value>, signal: AbortSignal, body?: Blob): Promise<Result<Value>> {
		let backing: ArrayBuffer | undefined, expectedBytes = 0;
		let id: string | undefined, plane: Uint8Array<ArrayBuffer> | undefined, failure: unknown, failed = false, result: Result<Value> | undefined;
		try {
			// Keep the issued ID even if later facts are corrupt, so malformed
			// delivery can still join its actual Main owner on the cleanup lane.
			check(signal);
			if (request.kind === 'input') {
				if (!body || body.size !== request.request.byteLength || await digestMediaContent(body, { chunkBytes: LIMITS.maximumRangeBytes, signal }) !== request.request.contentSha256) throw new Error('Native RAW import body differs from its completed input identity.');
			}
			const borrowed = await this.#transport.open(request, { signal });
			const outcome = borrowed && typeof borrowed === 'object' ? Object.getOwnPropertyDescriptor(borrowed, 'outcome') : undefined;
			const receipt = borrowed && typeof borrowed === 'object' ? Object.getOwnPropertyDescriptor(borrowed, 'ticket') : undefined;
			if (outcome && Object.hasOwn(outcome, 'value') && outcome.value === 'ready' && receipt && Object.hasOwn(receipt, 'value')) {
				const ticket: unknown = receipt.value;
				const selected = ticket && typeof ticket === 'object' ? Object.getOwnPropertyDescriptor(ticket, 'id') : undefined;
				if (selected && Object.hasOwn(selected, 'value') && typeof selected.value === 'string' && /^[a-f0-9]{64}$/u.test(selected.value)) id = selected.value;
			}
			let opened: ReturnType<typeof openOf>;
			try { opened = openOf(borrowed, request); }
			catch (error) { if (!id) this.#quarantine(new Error('Native RAW response has no provable output retirement identity.')); throw error; }
			check(signal);
			if (opened.outcome === 'web-fallback') result = opened;
			else {
				id = opened.ticket.id; const ticket = opened.ticket; expectedBytes = ticket.byteLength; backing = new ArrayBuffer(expectedBytes); plane = new Uint8Array(backing); const hash = sha256.create();
				try {
					for (let offset = 0; offset < plane.byteLength;) {
						check(signal); const length = Math.min(LIMITS.maximumRangeBytes, plane.byteLength - offset), borrowed = await this.#transport.read({ id }, offset, length);
						const chunk = copy(borrowed, LIMITS.maximumRangeBytes);
						try { check(signal); if (chunk.byteLength !== length) throw new RangeError('Native RAW output range length changed.'); plane.set(chunk, offset); hash.update(chunk); }
						finally { Reflect.apply(FILL, chunk, [0]); Reflect.apply(FILL, borrowed, [0]); } offset += length;
					}
					if (bytesToHex(hash.digest()) !== ticket.contentSha256) throw new Error('Native RAW output SHA-256 differs from complete delivery.'); check(signal);
				} finally { hash.destroy(); }
				const pixels = ticket.descriptor.sampleFormat === 'unorm16' ? new Uint16Array(plane.buffer) : ticket.descriptor.sampleFormat === 'float32' ? new Float32Array(plane.buffer) : plane;
				const view = { decoder: ticket.decoder, profile: ticket.profile, frame: { descriptor: ticket.descriptor, pixels }, rawFlip: ticket.rawFlip, exposureScale: ticket.exposureScale, contentSha256: ticket.contentSha256 };
				const admitted = request.kind === 'input' ? inputFrameOf({ ...view, input: ticket.input }, request.request) : request.kind === 'frame' ? frameOf(view, request.request) : previewOf({ ...view, source: ticket.source, recipe: ticket.recipe }, request.request);
				const value = await consume(admitted); check(signal); result = Object.freeze({ outcome: 'native', value });
			}
		} catch (error) { failed = true; failure = error; try { check(signal); } catch (reason) { failure = reason; } }
		{
			try {
				if (backing && Reflect.apply(SIZE, backing, []) !== expectedBytes) throw new Error('Native RAW output backing detached before actual retirement.');
				if (plane) Reflect.apply(FILL, plane, [0]);
			} catch (wipe) { this.#quarantine(wipe); failure = failed ? new AggregateError([failure, wipe], 'RAW consumer and actual plane retirement failed.', { cause: wipe }) : wipe; failed = true; }
			if (id) { try { const receipt = retiredOf(await this.#transport.close({ id })); if (receipt?.sourceFailed && !failed) { failed = true; failure = new Error('Native RAW source or Photo revision changed before completed delivery.'); } } catch (cleanup) { this.#quarantine(cleanup); failure = failed ? new AggregateError([failure, cleanup], 'RAW delivery and Main output retirement failed.', { cause: cleanup }) : cleanup; failed = true; } }
		}
		if (failed) throw failure; if (!result) throw new Error('Renderer RAW has no terminal result.'); return result;
	}
	#quarantine(error: unknown): void { this.#failure = this.#failed ? new AggregateError([this.#failure, error], 'Renderer RAW retirement remains unproved.', { cause: error }) : error; this.#failed = true; QUARANTINE.add(this); }
	#stopOwner(): void { if (!this.#closed) { this.#closed = true; Reflect.apply(ABORT, this.#stop, [new DOMException('Renderer RAW owner stopped.', 'AbortError')]); } }
	stop(): void { this.#stopOwner(); }
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void; this.#closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		const work = this.#active; try { this.#stopOwner(); } catch (error) { this.#quarantine(error); }
		void Promise.resolve().then(async () => { if (work) await Promise.allSettled([work]); if (this.#failed) throw this.#failure; }).then(resolve, reject); return this.#closing;
	}
}
