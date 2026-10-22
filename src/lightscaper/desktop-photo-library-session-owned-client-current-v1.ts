/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from './desktop-photo-library-session-storage-current-v1.ts';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls, desktopPhotoVoidCurrentV1 as empty, desktopPhotoSignalCurrentV1 as signalOf } from './desktop-photo-library-session-client-calls-current-v1.ts';
import { readDesktopPhotoLibrarySessionHandleCurrentV1 as handle } from './desktop-photo-library-session-protocol-current-v1.ts';
import { readDesktopPhotoArchiveContextCurrentV1 } from './desktop-photo-library-session-client-replies-current-v1.ts';
import { normalizePhotoSmartCollectionV1 } from './catalog/photo-smart-collection-v1.ts';
import { field, record } from './catalog/value-validation.ts';
import type { PhotoSmartCollectionArchiveCaptureV1 } from './catalog/photo-smart-collection-contract-v1.ts';

const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const ABORT = AbortController.prototype.abort, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
export async function createDesktopPhotoSessionArchiveCurrentV1(c: Calls, signal?: AbortSignal): Promise<PhotoSmartCollectionArchiveCaptureV1> {
	const release = c.reserve(0); let h: ReturnType<typeof handle<'archive'>> | undefined;
	try {
		const opened = await c.send('archive', () => ({ operation: 'open' }), value => record(value, 'archive open', ['handle', 'context']), signal, false, true);
		h = handle(field(opened, 'handle'), 'archive'); const context = readDesktopPhotoArchiveContextCurrentV1(field(opened, 'context'), c.descriptor.catalogId), issued = h;
		let claimed = false, pending: Promise<IteratorResult<ReturnType<typeof normalizePhotoSmartCollectionV1>>> | undefined;
		let returning: Promise<IteratorResult<ReturnType<typeof normalizePhotoSmartCollectionV1>>> | undefined, verifying: Promise<void> | undefined, terminal = false;
		const iterator: AsyncIterator<ReturnType<typeof normalizePhotoSmartCollectionV1>> = Object.freeze({
			next() {
				return c.own(() => {
					if (pending || returning || verifying || terminal) throw new Error('The saved archive iterator is busy or terminal.');
					const work = c.send('archive', () => ({ operation: 'next', handle: issued }), value => {
						const row = record(value, 'archive iterator result', ['done', 'value'], ['done']); const done = field(row, 'done');
						if (done === true) { if (Object.hasOwn(row, 'value') && field(row, 'value') !== undefined) throw new TypeError('Terminal archive result cannot carry a definition.'); return { done: true as const, value: undefined }; }
						if (done !== false) throw new TypeError('Archive next must declare done.'); const definition = normalizePhotoSmartCollectionV1(field(row, 'value'));
						if (definition.catalogId !== c.descriptor.catalogId) throw new TypeError('Foreign archived definition.'); return { done: false as const, value: definition };
					}, signal); pending = work;
					return work.finally(() => { pending = undefined; });
				});
			},
			return() {
				if (returning) return returning;
				returning = c.own(async () => {
					await pending?.catch(() => undefined); await verifying?.catch(() => undefined);
					if (!terminal) { await c.send('archive', () => ({ operation: 'return', handle: issued }), empty, undefined, true, true); terminal = true; release(); }
					return { done: true as const, value: undefined };
				}, true); void returning.catch(error => c.notice(error)); return returning;
			},
		});
		return Object.freeze({ context, definitions: Object.freeze({ [Symbol.asyncIterator]() { c.assert(); if (claimed) throw new Error('Saved archive source is single use.'); claimed = true; return iterator; } }),
			verify(): Promise<void> {
				if (verifying) return verifying;
				verifying = c.own(async () => { if (returning || terminal) throw new Error('Saved archive source is retired.'); await pending;
					await c.send('archive', () => ({ operation: 'verify', handle: issued }), empty, signal); terminal = true; release(); }); return verifying;
			},
		});
	} catch (primary) {
		if (h) { try { await c.send('archive', () => ({ operation: 'return', handle: h }), empty, undefined, true, true); } catch (cleanup) { c.notice(cleanup); throw new AggregateError([primary, cleanup], 'Archive capture and retirement failed.', { cause: cleanup }); } }
		release(); throw primary;
	}
}
export function createDesktopPhotoSessionExclusiveCurrentV1(c: Calls): Storage['exclusive'] {
	let busy = false;
	return function exclusive<Value>(catalogId: string, operation: (signal?: AbortSignal) => Promise<Value>, signal?: AbortSignal): Promise<Value> { return c.own(async () => {
		if (busy) throw new Error('A desktop catalog writer callback is already pending.'); busy = true;
		let h: ReturnType<typeof handle<'exclusive'>> | undefined, release = (): void => undefined;
		const controller = new AbortController(), detachers: (() => void)[] = []; let result!: Value, failed = false, primary: unknown;
		try {
			c.catalog(catalogId); if (typeof operation !== 'function') throw new TypeError('Catalog writer callback required.');
			const caller = signalOf(signal === undefined ? {} : { signal }); release = c.reserve(0);
			for (const source of [c.signal, ...(caller ? [caller] : [])]) {
				const abort = (): void => Reflect.apply(ABORT, controller, [Reflect.apply(REASON, source, [])]);
				Reflect.apply(ADD, source, ['abort', abort, { once: true }]); detachers.push(() => Reflect.apply(REMOVE, source, ['abort', abort])); if (source.aborted) abort();
			}
			controller.signal.throwIfAborted();
			h = await c.send('exclusive', () => ({ operation: 'begin' }), value => handle(field(record(value, 'exclusive acquisition', ['handle']), 'handle'), 'exclusive'), caller, false, true);
			c.enterExclusive(h.id); c.assert(); controller.signal.throwIfAborted(); result = await operation(controller.signal);
		} catch (error) { failed = true; primary = error; }
		let cleaned = false;
		try { if (h) await c.send('exclusive', () => ({ operation: failed ? 'cancel' : 'end', handle: h }), empty, undefined, true, true); cleaned = true; }
		catch (cleanup) { c.notice(cleanup); if (failed && !Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Writer callback and native retirement failed.', { cause: cleanup }); throw cleanup; }
		finally { if (h) c.leaveExclusive(h.id); for (const detach of detachers) detach(); if (cleaned) release(); busy = false; }
		if (failed) throw primary; return result;
	}); };
}
