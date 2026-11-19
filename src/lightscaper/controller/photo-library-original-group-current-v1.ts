/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainRecord, readClosedDomainField } from '../../common/foundation/closed-domain-value.ts';
import { canonicalMediaContentBlob } from '../../common/media/content-digest.ts';
import { readPhotoLibraryOriginalGroupCurrentV1 } from './photo-library-original-group-contract-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 as Source, PhotoLibraryOriginalRequestCurrentV1 as Request,
	PhotoLibraryOriginalGroupLeaseCurrentV1 as Lease } from './photo-library-original-source-current-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
function combined(primary: unknown, cleanup: unknown, message: string): unknown {
	return Object.is(primary, cleanup) ? primary : new AggregateError([primary, cleanup], message, { cause: cleanup });
}
/** A complete group is the admission unit. A per-file scoped adapter cannot
 * substitute sequential reservations; only the durable Web fallback does so. */
export async function acquirePhotoLibraryOriginalGroupCurrentV1(source: Source, value: readonly Readonly<Request>[], signal?: AbortSignal): Promise<Readonly<Lease>> {
	check(signal); const acquire = source.acquireGroup;
	if (typeof acquire !== 'function') throw new TypeError('Original group acquisition is unavailable.');
	let requests: readonly Readonly<Request>[];
	try { requests = readPhotoLibraryOriginalGroupCurrentV1(value).requests; check(signal); }
	catch (error) { check(signal); throw error; }
	const raw: unknown = await Reflect.apply(acquire, source, [requests, Object.freeze(signal === undefined ? {} : { signal })]);
	const descriptor = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'close') : undefined;
	const release: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
	if (typeof release !== 'function') throw new TypeError('Original group lease requires an own close capability.');
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> => {
		closing ??= Promise.resolve().then(async () => { await Reflect.apply(release, raw, []); }); return closing;
	};
	try {
		const lease = readClosedDomainRecord(raw, 'Original group lease', ['bodies', 'close']);
		const values = readClosedDomainArray(readClosedDomainField(lease, 'bodies', 'Original group lease'), 'Original group bodies', requests.length, requests.length);
		const snapshots = new Map<unknown, Blob>();
		const bodies = values.map((value, index) => {
			let body = snapshots.get(value);
			if (body === undefined) { body = canonicalMediaContentBlob(value); snapshots.set(value, body); }
			if (body.size !== requests[index]!.original.byteLength) throw new RangeError('Original group body byte length differs from its Photo.'); return body;
		});
		check(signal); return Object.freeze({ bodies: Object.freeze(bodies), close });
	} catch (error) {
		let primary = error; try { check(signal); } catch (reason) { primary = reason; }
		try { await close(); } catch (cleanup) { throw combined(primary, cleanup, 'Original group acquisition and cleanup failed.'); }
		throw primary;
	}
}
/** Retain every File and authority through the actual consumer and its joined
 * children. Cleanup outcome cannot be erased by a later cancellation check. */
export async function withPhotoLibraryOriginalGroupCurrentV1<Result>(source: Source, requests: readonly Readonly<Request>[],
	consume: (bodies: readonly Blob[]) => Result | Promise<Result>, signal?: AbortSignal): Promise<Result> {
	check(signal); if (typeof consume !== 'function') throw new TypeError('Original group requires its owning consumer.');
	const lease = await acquirePhotoLibraryOriginalGroupCurrentV1(source, requests, signal);
	let result!: Result, failed = false, primary: unknown;
	try { check(signal); result = await consume(lease.bodies); check(signal); }
	catch (error) { failed = true; primary = error; }
	try { await lease.close(); }
	catch (cleanup) { if (failed) throw combined(primary, cleanup, 'Original group consumer and cleanup failed.'); throw cleanup; }
	if (failed) throw primary; return result;
}
