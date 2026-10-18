/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { normalizePhotoOriginalV1 } from '../catalog/photo-document-envelope-v1.ts';
import type { PhotoOriginalV1 } from '../catalog/types.ts';
import { field, id, record } from '../catalog/value-validation.ts';
import { readPhotoLibraryOriginalGroupCurrentV1 } from './photo-library-original-group-contract-current-v1.ts';

export interface PhotoLibraryOriginalRequestCurrentV1 {
	readonly catalogId: string;
	readonly photoId: string;
	readonly original: Readonly<PhotoOriginalV1>;
}
export interface PhotoLibraryOriginalLeaseCurrentV1 {
	readonly body: Blob;
	close(): Promise<void>;
}
export interface PhotoLibraryOriginalGroupLeaseCurrentV1 {
	readonly bodies: readonly Blob[];
	close(): Promise<void>;
}
export interface PhotoLibraryOriginalSourceCurrentV1 {
	acquire(request: Readonly<PhotoLibraryOriginalRequestCurrentV1>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<PhotoLibraryOriginalLeaseCurrentV1>>;
	acquireGroup?(requests: readonly Readonly<PhotoLibraryOriginalRequestCurrentV1>[], options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<PhotoLibraryOriginalGroupLeaseCurrentV1>>;
}
type Fallback = (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<unknown>;
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

/** Capture the trusted selected owner once. The existing Web Core loader keeps
 * its genuine Blob fallback; a supplied scoped source always takes precedence. */
export function capturePhotoLibraryOriginalSourceCurrentV1(source: PhotoLibraryOriginalSourceCurrentV1 | undefined,
	fallback?: Fallback): Readonly<PhotoLibraryOriginalSourceCurrentV1> {
	if (source !== undefined) {
		const acquire = source.acquire, acquireGroup = source.acquireGroup;
		if (typeof acquire !== 'function') throw new TypeError('Original source requires an acquire capability.');
		if (acquireGroup !== undefined && typeof acquireGroup !== 'function') throw new TypeError('Original source requires a callable group capability.');
		return Object.freeze({ acquire: (request: Readonly<PhotoLibraryOriginalRequestCurrentV1>, options?: Readonly<{ signal?: AbortSignal }>) =>
			Reflect.apply(acquire, source, [request, options]) as Promise<Readonly<PhotoLibraryOriginalLeaseCurrentV1>>,
		...(acquireGroup === undefined ? {} : { acquireGroup: (requests: readonly Readonly<PhotoLibraryOriginalRequestCurrentV1>[], options?: Readonly<{ signal?: AbortSignal }>) =>
			Reflect.apply(acquireGroup, source, [requests, options]) as Promise<Readonly<PhotoLibraryOriginalGroupLeaseCurrentV1>> }) });
	}
	if (typeof fallback !== 'function') throw new TypeError('A complete Original source is required.');
	return Object.freeze({ async acquire(request: Readonly<PhotoLibraryOriginalRequestCurrentV1>, options: Readonly<{ signal?: AbortSignal }> = {}) {
		const body = canonicalMediaContentBlob(await fallback(request.original, options.signal));
		return Object.freeze({ body, close: async (): Promise<void> => undefined });
	}, async acquireGroup(value: readonly Readonly<PhotoLibraryOriginalRequestCurrentV1>[], options: Readonly<{ signal?: AbortSignal }> = {}) {
		check(options.signal); const { requests } = readPhotoLibraryOriginalGroupCurrentV1(value), byKey = new Map<string, Blob>(), bodies: Blob[] = [];
		for (const request of requests) {
			check(options.signal); let body = byKey.get(request.original.storageKey);
			if (body === undefined) { body = canonicalMediaContentBlob(await fallback(request.original, options.signal)); byKey.set(request.original.storageKey, body); }
			check(options.signal); bodies.push(body);
		}
		return Object.freeze({ bodies: Object.freeze(bodies), close: async (): Promise<void> => undefined });
	} });
}

/** The private lease is held through a generator yield or a whole callback.
 * Closing it means all consumers have joined; callers must not close a lease
 * while an escaped decoder, Blob reader, or archive encoder still uses it. */
export async function acquirePhotoLibraryOriginalCurrentV1(source: PhotoLibraryOriginalSourceCurrentV1,
	value: Readonly<PhotoLibraryOriginalRequestCurrentV1>, signal?: AbortSignal): Promise<Readonly<PhotoLibraryOriginalLeaseCurrentV1>> {
	check(signal); const acquire = source.acquire;
	if (typeof acquire !== 'function') throw new TypeError('Original source requires an acquire capability.');
	let request: Readonly<PhotoLibraryOriginalRequestCurrentV1>;
	try {
		const input = record(value, 'Original source request', ['catalogId', 'photoId', 'original']);
		request = Object.freeze({ catalogId: id(field(input, 'catalogId'), 'Original catalog ID'), photoId: id(field(input, 'photoId'), 'Original photo ID'),
			original: normalizePhotoOriginalV1(field(input, 'original')) });
		check(signal);
	} catch (error) { check(signal); throw error; }
	const raw: unknown = await (Reflect.apply(acquire, source, [request, Object.freeze(signal === undefined ? {} : { signal })]) as Promise<unknown>);
	// Capture cleanup before reflecting over or validating the body. A rejected
	// native body must still retire the resource handed back by its source.
	const descriptor = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'close') : undefined;
	const release: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
	if (typeof release !== 'function') throw new TypeError('Original source requires an own close capability.');
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> => {
		closing ??= Promise.resolve().then(async () => { await Reflect.apply(release, raw, []); });
		return closing;
	};
	try {
		const input = record(raw, 'Original source lease', ['body', 'close']);
		const body = canonicalMediaContentBlob(field(input, 'body'));
		if (body.size !== request.original.byteLength) throw new RangeError('Original body byte length differs from its binding.');
		check(signal); return Object.freeze({ body, close });
	} catch (error) {
		try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Original acquisition and cleanup failed.', { cause: cleanup }); }
		throw error;
	}
}

/** The actual consumer settles before cleanup. No cancellation race abandons
 * work, and opaque primary/cleanup reasons are retained independently. */
export async function withPhotoLibraryOriginalCurrentV1<Result>(source: PhotoLibraryOriginalSourceCurrentV1,
	request: Readonly<PhotoLibraryOriginalRequestCurrentV1>, consume: (body: Blob) => Result | Promise<Result>, signal?: AbortSignal): Promise<Result> {
	check(signal); if (typeof consume !== 'function') throw new TypeError('Original source requires a scoped consumer.');
	const lease = await acquirePhotoLibraryOriginalCurrentV1(source, request, signal);
	let failed = false, primary: unknown, result!: Result;
	try { check(signal); result = await consume(lease.body); check(signal); }
	catch (error) { failed = true; primary = error; }
	try { await lease.close(); }
	catch (cleanup) { if (failed) throw new AggregateError([primary, cleanup], 'Original consumer and cleanup failed.', { cause: cleanup }); throw cleanup; }
	if (failed) throw primary;
	return result;
}
