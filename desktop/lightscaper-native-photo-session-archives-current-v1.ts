/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LightscaperNativePhotoSessionLeaseCurrentV1 as Lease } from './lightscaper-native-photo-session-lease-current-v1.ts';
import type { LightscaperNativePhotoSessionHandlesCurrentV1 as Handles } from './lightscaper-native-photo-session-handles-current-v1.ts';
import type { PhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
const CHECK = AbortSignal.prototype.throwIfAborted;
export async function openLightscaperNativePhotoSessionArchiveCurrentV1(lease: Lease, handles: Handles, signal: AbortSignal, reserved?: ReturnType<Handles['reserve']>): Promise<unknown> {
	const booking = reserved ?? handles.reserve('archive'); let close: (() => Promise<void>) | undefined;
	try {
		const capture = await lease.components.catalog.captureSmartCollectionArchiveV1(lease.catalogId, { signal });
		const source = capture.definitions, iterator = source[Symbol.asyncIterator](), next = iterator.next, end = iterator.return, verify = capture.verify;
		if (typeof next !== 'function' || typeof end !== 'function' || typeof verify !== 'function') throw new TypeError('Native archive requires its actual complete iterator.');
		let pending: Promise<IteratorResult<PhotoSmartCollectionV1>> | undefined, closing: Promise<void> | undefined, verifying: Promise<void> | undefined, closed = false;
		close = () => {
			if (closing) return closing; closed = true;
			closing = Promise.resolve().then(async () => { if (pending) await Promise.allSettled([pending]); if (verifying) await Promise.allSettled([verifying]); await Reflect.apply(end, iterator, []); }); return closing;
		};
		booking.publish({ close, next: () => {
			if (closed || pending) return Promise.reject(new Error('Native archive iterator is busy or retired.'));
			pending = Promise.resolve().then(() => Reflect.apply(next, iterator, []) as Promise<IteratorResult<PhotoSmartCollectionV1>>);
			const actual = pending;
			void actual.then(() => { if (pending === actual) pending = undefined; }, () => { if (pending === actual) pending = undefined; });
			return actual.then(result => result.done ? { done: true } : { done: false, value: result.value });
		}, verify: () => {
			if (verifying) return verifying; closed = true;
			verifying = Promise.resolve().then(async () => { if (pending) await pending; await Reflect.apply(verify, capture, []); }); return verifying;
		} });
		Reflect.apply(CHECK, signal, []); return { handle: booking.handle, context: capture.context };
	} catch (primary) {
		if (close) { try { await close(); booking.abandon(); } catch (cleanup) { booking.quarantine({ close }); throw new AggregateError([primary, cleanup], 'Native archive acquisition and actual retirement failed.', { cause: cleanup }); } }
		else booking.abandon(); throw primary;
	}
}
