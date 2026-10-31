/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { name } from '../src/lightscaper/catalog/value-validation.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels, type DesktopPhotoLibrarySessionDescriptorCurrentV1 as Descriptor } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from './lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoSessionConnectionCurrentV1 as Connection } from './lightscaper-native-photo-session-connection-current-v1.ts';
const CHECK = AbortSignal.prototype.throwIfAborted;
type LocalOwner = Readonly<{ close(): Promise<void> }>;

/** Host verifies trusted actual sender/document ownership BEFORE entering this
 * API. Exact owner object identity, not a renderer DTO, selects its connection. */
export class LightscaperNativePhotoSessionServiceCurrentV1 {
	readonly #entries = new Map<object, Connection>();
	readonly #select: Scopes['openSelected']; readonly #lease: Scopes['openSessionLease'];
	#closed = false; #closing: Promise<void> | undefined;
	constructor(scopes: Scopes) {
		if (!(scopes instanceof Scopes)) throw new TypeError('Native Main Session service requires actual library Scopes.');
		const select = Scopes.prototype.openSelected, lease = Scopes.prototype.openSessionLease;
		this.#select = (...args) => Reflect.apply(select, scopes, args) as ReturnType<typeof select>;
		this.#lease = (...args) => Reflect.apply(lease, scopes, args) as ReturnType<typeof lease>;
	}
	open(documentOwner: object, payload: unknown, localOwner: LocalOwner, signal?: AbortSignal): Promise<Readonly<Descriptor>> {
		if (this.#closed || this.#entries.has(documentOwner)) return Promise.reject(new Error('Native document connection is closed or already registered.'));
		if (!documentOwner || typeof documentOwner !== 'object') return Promise.reject(new TypeError('An actual authenticated document owner is required.'));
		let closeActual: (() => Promise<void>) | undefined;
		const entry = new Connection(() => { if (!closeActual) return Promise.resolve(); return closeActual(); }); this.#entries.set(documentOwner, entry);
		let work: Promise<Readonly<Descriptor>>;
		try {
			if (signal !== undefined) assertPhotoStackQuerySignalV1(signal); entry.captureOpeningSignal(signal);
			const close = localOwner.close; if (typeof close !== 'function') throw new TypeError('Installed native local retirement owner is missing.');
			let localClosing: Promise<void> | undefined; closeActual = () => localClosing ??= Promise.resolve().then(() => Reflect.apply(close, localOwner, []) as Promise<void>);
			const input = record(payload, 'native Session open', ['name', 'openId']); entry.openId = token(field(input, 'openId', 'native Session open'));
			const catalogName = name(field(input, 'name', 'native Session open'), 'catalog name');
			work = Promise.resolve().then(async () => {
				Reflect.apply(CHECK, entry.openingSignal, []);
				const selected = await this.#select({ name: catalogName, signal: entry.openingSignal });
				Reflect.apply(CHECK, entry.openingSignal, []);
				const lease = await this.#lease(selected.scope, { close: () => entry.localClose() }, { signal: entry.openingSignal });
				const result = entry.install(lease); Reflect.apply(CHECK, entry.openingSignal, []); entry.assertOpen(); entry.finishOpening(); return result;
			});
		} catch (error) { work = Promise.reject(error); }
		entry.setOpening(work);
		return work.catch(async primary => {
			let failure: unknown = primary;
			try { Reflect.apply(CHECK, entry.openingSignal, []); } catch (reason) { failure = reason; }
			try { await this.close(documentOwner); } catch (cleanup) { throw new AggregateError([failure, cleanup], 'Native Session open and actual retirement failed.', { cause: cleanup }); } throw failure;
		});
	}
	dispatch(channel: string, documentOwner: object, envelope: unknown): Promise<unknown> {
		const entry = this.#entries.get(documentOwner);
		if (!entry) {
			if (channel === channels.stop || channel === channels.close) { try { token(field(record(envelope, 'native Session control', ['openId']), 'openId', 'native Session control')); return Promise.resolve(); } catch (error) { return Promise.reject(error); } }
			return Promise.reject(new Error('Native Session document owner is not installed.'));
		}
		if (channel === channels.stop || channel === channels.close) {
			try { const input = record(envelope, 'native Session control', ['openId']); if (token(field(input, 'openId', 'native Session control')) !== entry.openId) throw new Error('Native control belongs to another opening.');
				if (channel === channels.stop) { entry.stop(); return Promise.resolve(); } return this.close(documentOwner);
			} catch (error) { return Promise.reject(error); }
		}
		return entry.dispatch(channel, envelope);
	}
	stop(documentOwner: object, openId?: string): void {
		const entry = this.#entries.get(documentOwner); if (!entry) return;
		if (openId !== undefined && token(openId) !== entry.openId) throw new Error('Native stop belongs to another opening.'); entry.stop();
	}
	close(documentOwner: object): Promise<void> {
		const entry = this.#entries.get(documentOwner); if (!entry) return Promise.resolve();
		const actual = entry.close(); void actual.then(() => { if (this.#entries.get(documentOwner) === entry) this.#entries.delete(documentOwner); }, () => undefined); return actual;
	}
	closeAll(): Promise<void> {
		if (this.#closing) return this.#closing; this.#closed = true;
		this.#closing = Promise.resolve().then(async () => {
			const results = await Promise.allSettled([...this.#entries.keys()].map(owner => this.close(owner)));
			const failures = results.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
			if (failures.length) throw new AggregateError(failures, 'Native document Session retirement is unproved.');
		}); return this.#closing;
	}
}
function token(value: unknown): string { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw new TypeError('Native opening correlation must be lowercase64hex.'); return value; }
