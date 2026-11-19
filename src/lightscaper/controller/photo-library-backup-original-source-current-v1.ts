/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoOriginalV1 } from '../catalog/types.ts';
import { acquirePhotoLibraryOriginalCurrentV1, capturePhotoLibraryOriginalSourceCurrentV1,
	type PhotoLibraryOriginalSourceCurrentV1 } from './photo-library-original-source-current-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
interface Ports {
	readonly originalSource?: PhotoLibraryOriginalSourceCurrentV1;
	readonly loadOriginal?: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<unknown>;
}
/** Capture selected acquisition and the genuine legacy receiver before any
 * metadata await. No source is acquired until its exact Photo is demanded. */
export function capturePhotoLibraryBackupOriginalSourceCurrentV1(ports: Ports): Readonly<PhotoLibraryOriginalSourceCurrentV1> {
	const source = ports.originalSource, load = ports.loadOriginal;
	return capturePhotoLibraryOriginalSourceCurrentV1(source, typeof load === 'function' ? async (original, signal) => {
		const body: unknown = await Reflect.apply(load, ports, [original, signal]);
		if (signal !== undefined) Reflect.apply(CHECK, signal, []);
		if (body === null || body === undefined) throw new ReferenceError('The photo backup original is missing.');
		return body;
	} : undefined);
}

/** The encoder owns the yielded File until its actual reads and iterator
 * retirement join. Its caller must join the encoder before returning this
 * generator; advancing or returning it retires the exact held source lease. */
export async function* yieldPhotoLibraryBackupOriginalCurrentV1<Photo extends Readonly<{ catalogId: string; id: string; original: PhotoOriginalV1 }>>(
	photo: Photo, source: Readonly<PhotoLibraryOriginalSourceCurrentV1>, signal?: AbortSignal): AsyncGenerator<Readonly<{ photo: Photo; original: Blob }>> {
	const lease = await acquirePhotoLibraryOriginalCurrentV1(source, { catalogId: photo.catalogId, photoId: photo.id, original: photo.original }, signal);
	let failed = false, primary: unknown;
	const retire = async (): Promise<void> => {
		try { await lease.close(); }
		catch (cleanup) { if (failed && !Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Photo backup source and retirement failed.', { cause: cleanup }); throw cleanup; }
	};
	try { yield Object.freeze({ photo, original: lease.body }); }
	catch (error) { failed = true; primary = error; }
	finally { await retire(); }
	if (failed) throw primary;
}
