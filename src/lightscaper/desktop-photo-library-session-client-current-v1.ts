/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopPhotoLibrarySessionServiceCurrentV1 as Service, DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from './desktop-photo-library-session-storage-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as CHANNELS, readDesktopPhotoLibrarySessionDescriptorCurrentV1 as descriptor } from './desktop-photo-library-session-protocol-current-v1.ts';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls, desktopPhotoSignalCurrentV1 as signalOf, type Invoke } from './desktop-photo-library-session-client-calls-current-v1.ts';
import { createDesktopPhotoSessionCatalogCurrentV1 } from './desktop-photo-library-session-catalog-client-current-v1.ts';
import { createDesktopPhotoSessionSettingsCurrentV1, createDesktopPhotoSessionImportPresetsCurrentV1 } from './desktop-photo-library-session-settings-client-current-v1.ts';
import { createDesktopPhotoSessionMediaCurrentV1 } from './desktop-photo-library-session-media-client-current-v1.ts';
import { createDesktopPhotoSessionResourcesCurrentV1 } from './desktop-photo-library-session-resource-client-current-v1.ts';
import { createDesktopPhotoSessionOriginalTransportCurrentV1 } from './desktop-photo-library-session-original-client-current-v1.ts';
import { createDesktopPhotoSessionExclusiveCurrentV1 } from './desktop-photo-library-session-owned-client-current-v1.ts';
import { createDesktopPhotoLinkedLibraryPortCurrentV1 as linkedClient } from './desktop-photo-library-session-linked-client-current-v1.ts';
import { desktopPhotoBooleanCurrentV1 as boolean } from './desktop-photo-library-session-client-calls-current-v1.ts';
import { createDesktopPhotoSessionRawClientCurrentV1 as rawClient } from './desktop-photo-library-session-raw-client-current-v1.ts';
import { name } from './catalog/value-validation.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';

export interface DesktopPhotoLibrarySessionClientTransportCurrentV1 {
	invoke(channel: string, payload: unknown): Promise<unknown>;
	/** Trusted installed preload closure. No renderer-callable retirement ACK. */
	installRetirement(openId: string, handler: (kind: 'stop' | 'retire') => Promise<void>): () => void;
}
const RANDOM = crypto.getRandomValues, ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const ABORT = AbortController.prototype.abort, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
export function createDesktopPhotoLibrarySessionServiceCurrentV1(transport: Readonly<DesktopPhotoLibrarySessionClientTransportCurrentV1>): Service {
	const invokeMethod = transport.invoke, install = transport.installRetirement;
	if (typeof invokeMethod !== 'function' || typeof install !== 'function') throw new TypeError('Installed native Session transport required.');
	const invoke: Invoke = (channel, value) => Reflect.apply(invokeMethod, transport, [channel, value]) as Promise<unknown>;
	let opening = false;
	return Object.freeze<Service>({ open(options, localOwner) {
		if (opening) return Promise.reject(new Error('A desktop selected Session already owns this connection.'));
		opening = true;
		let localClose: (() => Promise<void>) | undefined, localClosing: Promise<void> | undefined, remove = (): void => undefined, detach = (): void => undefined;
		let rawOwner: ReturnType<typeof rawClient> | undefined;
		let calls: Calls | undefined, closing: Promise<void> | undefined, stopSent: Promise<unknown> | undefined;
		const controller = new AbortController(), openId = randomId();
		const stopLocal = (): Promise<void> => {
			calls?.fence();
			if (localClosing) return localClosing;
			let resolve!: () => void, reject!: (reason: unknown) => void; localClosing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
			try { if (!localClose) throw new Error('Native Session local owner is not captured.'); const joins = [localClose(), ...(rawOwner ? [rawOwner.close()] : [])]; void Promise.allSettled(joins).then(results => { const errors = results.flatMap(r => r.status === 'rejected' ? [r.reason as unknown] : []); if (errors.length) reject(new AggregateError(errors, 'Native local Session and RAW owners did not retire.')); else resolve(); }); } catch (error) { reject(error); }
			if (!controller.signal.aborted) Reflect.apply(ABORT, controller, [new DOMException('The native Session is retiring.', 'AbortError')]);
			void localClosing.catch(() => undefined); return localClosing;
		};
		let admitted: { name: string; signal?: AbortSignal };
		try {
			const close = localOwner.close; if (typeof close !== 'function') throw new TypeError('Actual local Session retirement owner required.');
			localClose = () => Reflect.apply(close, localOwner, []) as Promise<void>;
			remove = Reflect.apply(install, transport, [openId, (_kind: 'stop' | 'retire') => stopLocal()]) as () => void;
			if (typeof remove !== 'function') throw new TypeError('Installed lifecycle connection must return its detach owner.');
			const row = record(options, 'desktop Session open', ['name', 'signal'], ['name']);
			const signal = signalOf(Object.hasOwn(row, 'signal') ? { signal: field(row, 'signal', 'desktop Session open') } : {});
			admitted = { name: name(field(row, 'name', 'desktop Session open'), 'native Session name'), ...(signal ? { signal } : {}) };
			if (signal) {
				const abort = (): void => { Reflect.apply(ABORT, controller, [Reflect.apply(REASON, signal, [])]); void stopLocal().catch(() => undefined);
					stopSent ??= invoke(CHANNELS.stop, { openId }); void stopSent.catch(error => calls?.notice(error)); };
				Reflect.apply(ADD, signal, ['abort', abort, { once: true }]); detach = () => Reflect.apply(REMOVE, signal, ['abort', abort]); if (signal.aborted) abort();
			}
		} catch (error) { opening = false; remove(); detach(); return Promise.reject(error); }
		const accepted = invoke(CHANNELS.open, { name: admitted.name, openId });
		return (async () => {
			let primary: unknown;
			try {
				let issued: ReturnType<typeof descriptor>;
				try { issued = descriptor(await accepted); } catch (error) { if (controller.signal.aborted) throw Reflect.apply(REASON, controller.signal, []); throw error; }
				calls = new Calls(issued, controller, invoke); if (controller.signal.aborted) { await close(); throw Reflect.apply(REASON, controller.signal, []); }
				rawOwner = rawClient(calls);
				const linked = await calls.send('linked', () => ({ operation: 'available' }), boolean, controller.signal) ? linkedClient(calls, input => rawOwner!.forInput(input.id)) : undefined;
				const components: Storage['components'] = Object.freeze({ ...(linked ? { linked } : {}), raw: rawOwner.raw, rawImport: rawOwner.rawImport, catalog: createDesktopPhotoSessionCatalogCurrentV1(calls), media: createDesktopPhotoSessionMediaCurrentV1(calls),
					settings: createDesktopPhotoSessionSettingsCurrentV1(calls), resources: createDesktopPhotoSessionResourcesCurrentV1(calls),
					originalTickets: Object.freeze({ transport: createDesktopPhotoSessionOriginalTransportCurrentV1(calls) }), close });
				return Object.freeze<Storage>({ catalogId: issued.catalogId, selectionToken: issued.selectionToken, signal: controller.signal, components,
					importPresets: createDesktopPhotoSessionImportPresetsCurrentV1(calls), exclusive: createDesktopPhotoSessionExclusiveCurrentV1(calls), stop, close });
			} catch (error) { primary = error; }
			try { await close(); } catch (cleanup) { if (!Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Native Session opening and retirement failed.', { cause: cleanup }); }
			throw primary;
		})();
		function stop(): void { void stopLocal().catch(error => calls?.notice(error)); stopSent ??= invoke(CHANNELS.stop, { openId }); void stopSent.catch(error => calls?.notice(error)); }
		function close(): Promise<void> {
			if (closing) return closing;
			let resolve!: () => void, reject!: (reason: unknown) => void; closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
			const local = stopLocal();
			void (async () => { const errors: unknown[] = [];
				try { await invoke(CHANNELS.close, { openId }); } catch (error) { errors.push(error); }
				try { await local; } catch (error) { if (!errors.some(e => Object.is(e, error))) errors.push(error); }
				try { await calls?.drain(); } catch (error) { errors.push(error); }
				try { await stopSent; } catch (error) { if (!errors.some(e => Object.is(e, error))) errors.push(error); }
				if (errors.length) throw new AggregateError(errors, 'Native Session client retirement failed.'); remove(); detach(); opening = false;
			})().then(resolve, reject); return closing;
		}
	} });
}
function randomId(): string { const bytes = new Uint8Array(32); Reflect.apply(RANDOM, crypto, [bytes]); return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
