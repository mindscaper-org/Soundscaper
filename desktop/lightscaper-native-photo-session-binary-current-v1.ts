/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import type { LightscaperNativePhotoSessionLeaseCurrentV1 as Lease } from './lightscaper-native-photo-session-lease-current-v1.ts';
import { LightscaperNativePhotoSessionHandlesCurrentV1 as Handles, type LightscaperNativePhotoSessionHandleOwnerCurrentV1 as Owner } from './lightscaper-native-photo-session-handles-current-v1.ts';
import { copyLightscaperNativePhotoSessionBytesCurrentV1 as copy, lightscaperNativePhotoSessionByteReaderCurrentV1 as byteReader, hashLightscaperNativePhotoSessionBlobCurrentV1 as hashBlob } from './lightscaper-native-photo-session-bytes-current-v1.ts';
import { captureDesktopPhotoCloneCurrentV1 as encode, readDesktopPhotoCloneCurrentV1 as decode, retireDesktopPhotoCloneCurrentV1 as retire, measureDesktopPhotoCloneCurrentV1 as measure } from '../src/lightscaper/desktop-photo-clone-current-v1.ts';
import type { BinaryDerivativeCacheProfileV1 as Profile, BinaryDerivativeCacheIdentityV1 as Identity } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import type { CatalogOriginalRepairBindingV1 } from '../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import type { VideoCubeLutReferenceV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { preflightLightscaperNativePhotoSessionMetadataCurrentV1 as preflightMetadata } from './lightscaper-native-photo-session-metadata-current-v1.ts';
type Packet = Readonly<Record<string, unknown>>;
type Booking = ReturnType<Handles['reserve']>;
const CHECK = AbortSignal.prototype.throwIfAborted, CLONE = globalThis.structuredClone;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const check = (signal: AbortSignal) => { Reflect.apply(CHECK, signal, []); };
async function metadata(value: unknown): Promise<unknown> {
	if (value === null) return null; const wire = await encode(value);
	try { return CLONE(wire); } finally { retire(wire); }
}

/** Bounded concrete owners over native files, cache records and resource
 * callbacks. No wire object supplies a body proof or publisher capability. */
export class LightscaperNativePhotoSessionBinaryCurrentV1 {
	readonly #lease: Lease; readonly #handles: Handles;
	#metadataReading = false;
	constructor(lease: Lease, handles: Handles) { this.#lease = lease; this.#handles = handles; }
	async execute(family: string, p: Packet, signal: AbortSignal, booking?: Booking): Promise<unknown> {
		const op = p.operation;
		if (family === 'upload') {
			if (op === 'write') { const owner = this.#handles.owner(p.handle, 'upload'); if (!owner.write) throw new TypeError('Missing upload writer.'); return owner.write(p.sequence as number, p.offset as number, p.bytes); }
			if (op === 'commit') { const owner = this.#handles.owner(p.handle, 'upload'); if (!owner.commit) throw new TypeError('Missing upload publisher.'); const result = await owner.commit();
				// The genuine publisher fulfilled. Failed actual retirement stays
				// strongly owned by Handles and is reported again by Session close.
				try { await this.#handles.close(p.handle, 'upload'); } catch { /* Durable ACK survives; the failed owner/debt is retained. */ } return result; }
			if (op === 'abort') return this.#handles.close(p.handle, 'upload');
			if (op === 'metadata') {
				if (this.#metadataReading) throw new RangeError('Native Session metadata-read capacity is full.');
				this.#metadataReading = true;
				try { return await metadata(await this.#lease.components.media.readSessionAssetMetadataCurrentV1(p.assetId as string)); }
				finally { this.#metadataReading = false; }
			}
			if (op === 'delete-asset') return this.#lease.components.media.deleteAsset(p.assetId as string, { signal });
			if (op === 'inspect') return this.#lease.components.media.inspectCatalogOriginalBody(p.binding as CatalogOriginalRepairBindingV1, { signal });
			return this.#begin(p, signal, booking);
		}
		if (family === 'cache') {
			if (op === 'trim') return this.#cache(p.profile as Profile).trim(signal);
			if (op === 'load') return this.#load(p, signal, booking);
			if (op === 'close-download') return this.#handles.close(p.handle, 'download');
			const owner = this.#handles.owner(p.handle, 'download'); if (!owner.read) throw new TypeError('Missing native body reader.'); return owner.read(p.offset as number, p.length as number);
		}
		if (family === 'resource') {
			if (op === 'close') return this.#handles.close(p.handle, 'resource');
			if (op === 'read') { const owner = this.#handles.owner(p.handle, 'resource'); if (!owner.read) throw new TypeError('Missing native resource reader.'); return owner.read(p.offset as number, p.length as number); }
			if (op === 'open') return this.#resource(p, signal, booking);
			const resources = await this.#resourceFamily(p.family); check(signal);
			if (op === 'verify-photo') return resources.verifyPhoto(p.photo, signal);
			if (op === 'verify-preset') return resources.verifyPreset(p.preset, signal);
			if (op === 'verify-references') return resources.verifyReferencesV1(p.references as readonly Readonly<VideoCubeLutReferenceV1 & BrushMaskResourceReferenceV1>[], signal);
		}
		throw new TypeError('Unknown native binary family operation.');
	}
	#cache(profile: Profile) {
		if (JSON.stringify(profile) !== JSON.stringify(PHOTO_PREVIEW_CACHE_PROFILE_V1)) throw new TypeError('Native Session cache requires its maintained Photo profile.');
		return this.#lease.components.media.createBinaryDerivativeCache(profile);
	}
	#resourceFamily(family: unknown) {
		if (family === 'lut') return this.#lease.components.resources.cubeLutResources();
		if (family === 'brush') return this.#lease.components.resources.maskRasterResources();
		throw new TypeError('Unknown native resource family.');
	}
	async #load(p: Packet, signal: AbortSignal, reserved?: Booking): Promise<unknown> {
		const identity = p.identity as Identity, booking = reserved ?? this.#handles.reserve('download');
		let owner: Owner | undefined;
		try {
			booking.charge(identity.byteLength);
			const loaded = await this.#cache(p.profile as Profile).load(identity, signal); check(signal);
			if (!loaded) { booking.abandon(); return null; }
			if (loaded.body.size !== identity.byteLength || await hashBlob(loaded.body) !== loaded.outputSha256) throw new Error('Actual native cache body failed its complete digest binding.');
			check(signal); let closed = false, closing: Promise<void> | undefined; const active = new Set<Promise<Uint8Array<ArrayBuffer>>>();
			owner = { read: (offset, length) => {
				if (closed || active.size !== 0 || offset + length > loaded.body.size) return Promise.reject(new RangeError('Native cache range is invalid or closed.'));
				const work = loaded.body.slice(offset, offset + length).arrayBuffer().then(buffer => new Uint8Array(buffer)); active.add(work);
				void work.then(() => { active.delete(work); }, () => { active.delete(work); }); return work;
			}, close: () => { if (closing) return closing; closed = true; closing = Promise.allSettled([...active]).then(() => undefined); return closing; } };
			booking.publish(owner); return { handle: booking.handle, identity: loaded.identity, outputSha256: loaded.outputSha256, mimeType: loaded.body.type, byteLength: loaded.body.size };
		} catch (primary) { if (owner) { try { await owner.close(); booking.abandon(); } catch (cleanup) { booking.quarantine(owner); throw new AggregateError([primary, cleanup], 'Native cache admission and retirement failed.', { cause: cleanup }); } } else booking.abandon(); throw primary; }
	}
	async #resource(p: Packet, signal: AbortSignal, reserved?: Booking): Promise<unknown> {
		const ref = p.reference as Readonly<VideoCubeLutReferenceV1 & BrushMaskResourceReferenceV1>, booking = reserved ?? this.#handles.reserve('resource');
		let resolve!: () => void, reject!: (error: unknown) => void, release!: () => void;
		const ready = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; }), gate = new Promise<void>(accept => { release = accept; });
		let actual: Promise<unknown> | undefined, owner: Owner | undefined;
		try {
			booking.charge(ref.byteLength);
			const resources = await this.#resourceFamily(p.family); check(signal);
			actual = resources.source.withBytes(ref, async bytes => {
				if (bytes.byteLength !== ref.byteLength) throw new Error('Actual native resource differs from its declared byte length.');
				let closing: Promise<void> | undefined;
				owner = byteReader(bytes, () => { if (closing) return closing; release(); closing = actual!.then(() => undefined, (failure: unknown) => { if (Reflect.apply(ABORTED, signal, []) === true && Object.is(failure, Reflect.apply(REASON, signal, []))) return; throw failure; }); return closing; });
				booking.publish(owner); resolve(); await gate;
			}, { signal });
			void actual.then(() => { if (!owner) reject(new Error('Native resource did not enter its actual callback.')); }, reject);
			await ready; check(signal); return { handle: booking.handle, byteLength: ref.byteLength };
		} catch (primary) {
			if (owner) { try { await owner.close(); booking.abandon(); } catch (cleanup) { booking.quarantine(owner); throw new AggregateError([primary, cleanup], 'Native resource admission and callback retirement failed.', { cause: cleanup }); } }
			else { if (actual) await Promise.allSettled([actual]); booking.abandon(); }
			throw primary;
		}
	}
	async #begin(p: Packet, signal: AbortSignal, reserved?: Booking): Promise<unknown> {
		const booking = reserved ?? this.#handles.reserve('upload'); let owner: Owner | undefined;
		try {
			if (p.operation === 'asset-begin') {
				if (!reserved) booking.charge(measure(p.metadata));
				const captured = await decode(p.metadata); check(signal);
				await preflightMetadata(p.assetId as string, captured, measure(p.metadata), debt => { booking.charge(debt); }); check(signal);
				const writer = await this.#lease.components.media.beginAssetWrite(p.assetId as string, captured as Readonly<Record<string, unknown>>, { expectedBytes: p.expectedBytes as number, expectedSha256: p.expectedSha256 as string, signal });
				owner = this.#streamOwner(p.expectedBytes as number, bytes => writer.write(bytes), async () => metadata(await writer.commit()), () => writer.abort());
			} else if (p.operation === 'repair-begin') {
				const binding = p.binding as CatalogOriginalRepairBindingV1;
				if (binding.size !== p.expectedBytes || binding.sha256 !== p.expectedSha256) throw new TypeError('Repair upload differs from its exact saved binding.');
				const upload = await this.#lease.components.media.beginOriginalRepairUploadCurrentV1({ expectedBytes: p.expectedBytes as number, expectedSha256: p.expectedSha256 as string });
				owner = this.#streamOwner(p.expectedBytes as number, bytes => upload.write(bytes), async () => this.#lease.components.media.restoreCatalogOriginalBodyFromSourceCurrentV1(binding, await upload.finish(), { signal }), () => upload.close());
			} else {
				const identity = p.identity as Identity | undefined, ref = p.reference as Readonly<VideoCubeLutReferenceV1 & BrushMaskResourceReferenceV1> | undefined;
				const expected = p.operation === 'cache-begin' ? identity!.byteLength : p.operation === 'resource-begin' ? ref!.byteLength : p.expectedBytes as number;
				booking.charge(expected); const bytes = new Uint8Array(expected), hash = createHash('sha256');
				const digest = p.operation === 'cache-begin' ? p.expectedOutputSha256 : p.operation === 'resource-begin' ? ref!.sha256 : p.expectedSha256;
				owner = this.#streamOwner(expected, chunk => { hash.update(chunk); return Promise.resolve(); }, async () => {
					if (hash.digest('hex') !== digest) throw new Error('Native bounded upload failed its full digest.'); check(signal);
					if (p.operation === 'cache-begin') return this.#cache(p.profile as Profile).store(identity, new Blob([bytes], { type: p.mimeType as string }), p.expectedOutputSha256 as string, signal);
					const resources = await this.#resourceFamily(p.family); check(signal);
					if (p.operation === 'resource-file-begin') {
						if (!('importFile' in resources)) throw new TypeError('Native resource file parser is unavailable.');
						return resources.importFile(new File([bytes], p.name as string, { type: p.mimeType as string }), { signal });
					}
					return resources.put(ref, bytes, { signal });
				}, () => { bytes.fill(0); return Promise.resolve(); }, bytes);
			}
			booking.publish(owner); check(signal); return { handle: booking.handle, maximumChunkBytes: 1_048_576, bytesWritten: 0 };
		} catch (primary) {
			if (owner) { try { await owner.close(); booking.abandon(); } catch (cleanup) { booking.quarantine(owner); throw new AggregateError([primary, cleanup], 'Native upload admission and retirement failed.', { cause: cleanup }); } } else booking.abandon();
			throw primary;
		}
	}
	#streamOwner(expected: number, write: (bytes: Uint8Array<ArrayBuffer>) => Promise<unknown>, publish: () => Promise<unknown>, retireOwner: () => Promise<void>, buffer?: Uint8Array<ArrayBuffer>): Owner {
		let offset = 0, sequence = 0, busy: Promise<unknown> | undefined, closing: Promise<void> | undefined, commit: Promise<unknown> | undefined, terminal = false;
		return { write: (next, start, value) => {
			if (terminal || busy || next !== sequence || start !== offset) return Promise.reject(new Error('Native upload sequence is busy, stale or retired.'));
			let bytes: Uint8Array<ArrayBuffer>; try { bytes = copy(value); if (offset + bytes.byteLength > expected) { bytes.fill(0); throw new RangeError('Native upload exceeds its exact expected length.'); } } catch (error) { return Promise.reject(error); }
			const accepted = offset, received = sequence;
			busy = Promise.resolve().then(async () => { if (buffer) buffer.set(bytes, accepted); await write(bytes); offset += bytes.byteLength; sequence++; return { sequence: received, offset }; }).finally(() => { bytes.fill(0); busy = undefined; }); return busy;
		}, commit: () => {
			if (commit) return commit;
			if (terminal || busy || offset !== expected) return Promise.reject(new Error('Native upload is incomplete or still writing.'));
			terminal = true; commit = publish(); return commit;
		}, close: () => {
			if (closing) return closing; terminal = true;
			closing = Promise.resolve().then(async () => { if (busy) await Promise.allSettled([busy]); if (commit) await Promise.allSettled([commit]); await retireOwner(); }); return closing;
		} };
	}
}
