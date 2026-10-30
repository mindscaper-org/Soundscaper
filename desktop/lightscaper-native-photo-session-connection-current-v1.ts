/* SPDX-License-Identifier: AGPL-3.0-only */

import { captureLightscaperNativePhotoSessionLinkedFacadeCurrentV1 as linkedFacade } from './lightscaper-native-photo-linked-components-current-v1.ts';
import type { LightscaperNativePhotoLinkedSessionCurrentV1 as Linked } from './lightscaper-native-photo-linked-session-current-v1.ts';
import { LightscaperNativePhotoSessionRawCurrentV1 as Raw } from './lightscaper-native-photo-session-raw-current-v1.ts';
import type { DesktopPhotoRawRequestCurrentV1 as RawRequest } from '../src/lightscaper/desktop-photo-raw-contract-current-v1.ts';
import { randomBytes } from 'node:crypto';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels, readDesktopPhotoLibrarySessionRequestIdentityCurrentV1 as identityReader,
	type DesktopPhotoLibrarySessionDescriptorCurrentV1 as Descriptor } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { readDesktopPhotoLibrarySessionPacketCurrentV1 as packetReader, desktopPhotoSessionOperationCurrentV1 as operation } from '../src/lightscaper/desktop-photo-library-session-packets-current-v1.ts';
import { measureDesktopPhotoCloneCurrentV1 } from '../src/lightscaper/desktop-photo-clone-current-v1.ts';
import { LightscaperNativePhotoSessionHandlesCurrentV1 as Handles } from './lightscaper-native-photo-session-handles-current-v1.ts';
import { LightscaperNativePhotoSessionBinaryCurrentV1 as Binary } from './lightscaper-native-photo-session-binary-current-v1.ts';
import { LightscaperNativePhotoSessionExclusiveCurrentV1 as Exclusive } from './lightscaper-native-photo-session-exclusive-current-v1.ts';
import { openLightscaperNativePhotoSessionArchiveCurrentV1 as archive } from './lightscaper-native-photo-session-archives-current-v1.ts';
import { dispatchLightscaperNativePhotoSessionOriginalCurrentV1 as original } from './lightscaper-native-photo-session-originals-current-v1.ts';
import { dispatchLightscaperNativePhotoSessionDomainCurrentV1 as domain, lightscaperNativePhotoSessionOwnsAckCurrentV1 as ownsAck } from './lightscaper-native-photo-session-domains-current-v1.ts';
import type { LightscaperNativePhotoSessionLeaseCurrentV1 as Lease } from './lightscaper-native-photo-session-lease-current-v1.ts';
const CHECK = AbortSignal.prototype.throwIfAborted, ABORT = AbortController.prototype.abort;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const check = (signal: AbortSignal) => { Reflect.apply(CHECK, signal, []); };
type Packet = Readonly<Record<string, unknown>>;
interface Work { readonly controller: AbortController; readonly promise: Promise<unknown> }
export class LightscaperNativePhotoSessionConnectionCurrentV1 {
	readonly handles = new Handles();
	readonly #openingController = new AbortController();
	#openingDetach: (() => void) | undefined;
	readonly #localClose: () => Promise<void>;
	readonly #active = new Map<number, Work>();
	#linked: Linked | undefined;
	#raw: Raw | undefined;
	#lease: Lease | undefined; #descriptor: Readonly<Descriptor> | undefined; #binary: Binary | undefined; #exclusive: Exclusive | undefined;
	#watermark = 0; #stopped = false; #closing: Promise<void> | undefined; #localClosing: Promise<void> | undefined;
	#opening: Promise<unknown> | undefined;
	openId: string | undefined;
	constructor(localClose: () => Promise<void>) { this.#localClose = localClose; }
	get openingSignal(): AbortSignal { return this.#openingController.signal; }
	captureOpeningSignal(signal?: AbortSignal): void {
		if (signal === undefined) return;
		const forward = (): void => { if (Reflect.apply(ABORTED, this.openingSignal, []) === false) Reflect.apply(ABORT, this.#openingController, [Reflect.apply(REASON, signal, [])]); };
		Reflect.apply(ADD, signal, ['abort', forward, { once: true }]); this.#openingDetach = () => { Reflect.apply(REMOVE, signal, ['abort', forward]); };
		if (Reflect.apply(ABORTED, signal, []) === true) forward();
	}
	finishOpening(): void { this.#openingDetach?.(); this.#openingDetach = undefined; }
	setOpening(work: Promise<unknown>): void { this.#opening = work; }
	install(lease: Lease): Readonly<Descriptor> {
		this.#lease = lease; this.#binary = new Binary(lease, this.handles); this.#exclusive = new Exclusive(lease, this.handles);
		this.#descriptor = Object.freeze({ schemaVersion: 1, kind: 'desktop-photo-session', profile: 'current3', sessionId: randomBytes(32).toString('hex'), catalogId: lease.catalogId, selectionToken: lease.selectionToken });
		if (lease.components.linked) this.#linked = linkedFacade(lease.components.linked).createSession(lease.catalogId, this.handles, { signal: lease.signal, assertCurrent: () => this.assertOpen() });
		if (lease.components.rawParts) this.#raw = Raw.create({ lease, handles: this.handles, ...(this.#linked ? { linked: this.#linked } : {}) });
		if (this.#stopped) lease.stop(); return this.#descriptor;
	}
	assertOpen(): void { if (this.#stopped || !this.#lease || !this.#descriptor) throw new Error('Native Main Session is stopped or not open.'); check(this.#lease.signal); }
	stop(): void {
		if (this.#stopped) return; this.#stopped = true;
		Reflect.apply(ABORT, this.#openingController, [new DOMException('Native Main opening stopped.', 'AbortError')]);
		this.#lease?.stop();
		for (const work of this.#active.values()) Reflect.apply(ABORT, work.controller, [new DOMException('Native Session request stopped.', 'AbortError')]);
	}
	/** Passed to the genuine native lease. It never waits for opening/outer close,
	 * which can themselves be awaiting this exact local retirement barrier. */
	localClose(): Promise<void> {
		if (this.#localClosing) return this.#localClosing;
		this.#localClosing = Promise.resolve().then(async () => {
			this.stop(); await this.#localClose(); this.finishOpening();
			await this.#raw?.close(); await this.#linked?.close();
			const results = await Promise.allSettled([this.handles.closeAll(), Promise.allSettled([...this.#active.values()].map(value => value.promise))]);
			const failures = results.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
			if (failures.length) throw new AggregateError(failures, 'Native Main consumers or handle retirement are unproved.');
		}); return this.#localClosing;
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void; this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		const failures: unknown[] = []; try { this.stop(); } catch (error) { failures.push(error); }
		void Promise.resolve().then(async () => {
			if (this.#opening) await Promise.allSettled([this.#opening]);
			try { if (this.#lease) await this.#lease.close(); else await this.localClose(); } catch (error) { failures.push(error); }
			if (failures.length) throw new AggregateError(failures, 'Native Main Session retirement is unproved.');
		}).then(resolve, reject); return this.#closing;
	}
	dispatch(channel: string, value: unknown): Promise<unknown> {
		try {
			const input = record(value, 'native Session envelope', ['identity', 'payload']), identity = identityReader(field(input, 'identity', 'native Session envelope'));
			if (!this.#descriptor || identity.sessionId !== this.#descriptor.sessionId || identity.requestId <= this.#watermark) throw new Error('Native Session identity is foreign or replayed.');
			this.#watermark = identity.requestId;
			const raw = field(input, 'payload', 'native Session envelope'), family = channel.slice(channel.lastIndexOf(':') + 1);
			const op = family.startsWith('original-') || family.startsWith('raw-') && family !== 'raw-input' || channel === channels.cancel ? '' : operation(raw);
			const cleanup = cleanupOperation(family, op);
			if (!cleanup) this.assertOpen();
			if (channel === channels.cancel) { const p = packetReader(channel, raw, this.#descriptor.catalogId); const target = this.#active.get(p.requestId as number); if (target) Reflect.apply(ABORT, target.controller, [new DOMException('Native Session request cancelled.', 'AbortError')]); return Promise.resolve(); }
			if (!cleanup && this.#active.size >= 16) throw new RangeError('Native Session data request capacity is full.');
			if (isAcquisition(family, op) || family === 'linked' && (op === 'scan-open' || op === 'input-open')) this.handles.assertCapacity();
			if (!cleanup && !(family === 'exclusive' && op === 'begin')) this.#exclusive!.admit(identity.exclusiveId);
			if (cleanup) { const p = packetReader(channel, raw, this.#descriptor.catalogId); return this.#execute(family, p, new AbortController().signal); }
			let resolve!: (value: unknown) => void, reject!: (reason: unknown) => void;
			const promise = new Promise<unknown>((accept, refuse) => { resolve = accept; reject = refuse; }), controller = new AbortController();
			this.#active.set(identity.requestId, { promise, controller });
			if (!(family === 'exclusive' && op === 'begin')) this.#exclusive!.admit(identity.exclusiveId, promise);
			let p: Packet, actual: Promise<unknown>, booking: ReturnType<Handles['reserve']> | undefined;
			try {
				if (isAcquisition(family, op)) {
					const kind = family === 'raw-input' ? 'raw-input' : family === 'cache' ? 'download' : family === 'resource' ? 'resource' : family === 'archive' ? 'archive' : family === 'exclusive' ? 'exclusive' : 'upload';
					booking = this.handles.reserve(kind);
					if (family === 'upload' && op === 'asset-begin') booking.charge(measureDesktopPhotoCloneCurrentV1(field(raw as Record<string, unknown>, 'metadata', 'asset upload')));
				}
				p = packetReader(channel, raw, this.#descriptor.catalogId); check(controller.signal); actual = this.#execute(family, p, controller.signal, booking);
			} catch (error) { booking?.abandon(); p = {}; actual = Promise.reject(error); }
			void actual.then(async result => {
				try {
					if (!ownsAck(family, p, result) && !linkedAck(family, p, result)) { try { check(controller.signal); } catch (primary) { await this.#retireUnpublished(family, p, result, primary); } }
					resolve(result);
				} catch (error) { reject(error); }
			}, reject).finally(() => { this.#active.delete(identity.requestId); });
			return promise;
		} catch (error) { return Promise.reject(error); }
	}
	#execute(family: string, p: Packet, signal: AbortSignal, booking?: ReturnType<Handles['reserve']>): Promise<unknown> {
		const lease = this.#lease!;
		if (family === 'linked') { if (p.operation === 'available') return Promise.resolve(Boolean(this.#linked)); return this.#linked ? this.#linked.execute(p, signal) : Promise.reject(new Error('Native linked folders are unavailable.')); }
		if (family === 'raw-input') { if (p.operation === 'available') return Promise.resolve(Boolean(this.#raw)); if (!this.#raw) return Promise.reject(new Error('Native RAW inputs are unavailable.')); return this.#raw.executeInput(p, signal, booking); }
		if (family === 'raw-open') return this.#raw ? this.#raw.transport.open(p.request as RawRequest, { signal }) : Promise.resolve(Object.freeze({ outcome: 'web-fallback', reason: 'native-unavailable' }));
		if (family === 'raw-close') return this.#raw ? this.#raw.transport.close(p.ticket as { id: string }) : Promise.reject(new ReferenceError('No native RAW output was issued.'));
		if (family === 'raw-read') return this.#raw ? this.#raw.transport.read(p.ticket as { id: string }, p.offset as number, p.length as number) : Promise.reject(new ReferenceError('No native RAW output was issued.'));
		if (family === 'upload' || family === 'cache' || family === 'resource') return this.#binary!.execute(family, p, signal, booking);
		if (family.startsWith('original-')) return original(lease, family, p, signal);
		if (family === 'archive') {
			if (p.operation === 'open') return archive(lease, this.handles, signal, booking);
			if (p.operation === 'return') return this.handles.close(p.handle, 'archive');
			if (p.operation === 'verify') return this.handles.close(p.handle, 'archive', 'verify');
			const owner = this.handles.owner(p.handle, 'archive'); if (!owner.next) return Promise.reject(new TypeError('Missing native archive iterator.')); return owner.next();
		}
		if (family === 'exclusive') { if (p.operation === 'begin') return this.#exclusive!.begin(signal, booking); return this.handles.close(p.handle, 'exclusive'); }
		return domain(lease, family, p, signal);
	}
	async #retireUnpublished(family: string, p: Packet, result: unknown, primary: unknown): Promise<never> {
		try {
			if (family === 'linked' && (p.operation === 'scan-open' || p.operation === 'input-open')) await this.handles.close((result as { handle: unknown }).handle, p.operation === 'scan-open' ? 'linked-scan' : 'linked-input');
			else if (family === 'raw-open' && result && typeof result === 'object' && 'outcome' in result && result.outcome === 'ready' && 'ticket' in result) await this.#raw!.transport.close({ id: (result as { ticket: { id: string } }).ticket.id });
			else if (family === 'original-open' || family === 'original-open-group') { const ticket = { id: (result as { id: string }).id }; const transport = this.#lease!.components.originalTickets.transport; if (family === 'original-open') await transport.close(ticket); else await transport.closeGroup!(ticket); }
			else if (isAcquisition(family, p.operation as string) && result && typeof result === 'object' && 'handle' in result) {
				const kind = family === 'raw-input' ? 'raw-input' : family === 'cache' ? 'download' : family === 'resource' ? 'resource' : family === 'archive' ? 'archive' : family === 'exclusive' ? 'exclusive' : 'upload';
				await this.handles.close((result as { handle: unknown }).handle, kind);
			}
		} catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native undelivered acquisition retirement failed.', { cause: cleanup }); }
		throw primary;
	}
}
function cleanupOperation(family: string, op: string): boolean {
	return (family === 'linked' && (op === 'scan-close' || op === 'input-close')) || family === 'raw-close' || (family === 'raw-input' && op === 'close') || family === 'cancel' || family === 'original-close' || family === 'original-close-group'
		|| (family === 'upload' && op === 'abort') || (family === 'cache' && op === 'close-download') || (family === 'resource' && op === 'close')
		|| (family === 'archive' && (op === 'return' || op === 'verify')) || (family === 'exclusive' && (op === 'end' || op === 'cancel'));
}
function isAcquisition(family: string, op: string): boolean {
	return (family === 'raw-input' && op === 'begin') || (family === 'upload' && op.endsWith('-begin')) || (family === 'cache' && op === 'load') || (family === 'resource' && op === 'open') || (family === 'archive' && op === 'open') || (family === 'exclusive' && op === 'begin');
}

function linkedAck(family: string, packet: Packet, result: unknown): boolean {
	return family === 'linked' && (packet.operation === 'publish-input' || packet.operation === 'relink-input' || packet.operation === 'choose-folder' && result !== null || packet.operation === 'revoke' && result === true);
}
