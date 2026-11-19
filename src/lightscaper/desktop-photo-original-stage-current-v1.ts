/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { DESKTOP_PHOTO_ORIGINAL_LIMITS_CURRENT_V1 as LIMITS, type DesktopPhotoOriginalDirectoryCurrentV1,
	type DesktopPhotoOriginalStorageCurrentV1, type DesktopPhotoOriginalTicketCurrentV1,
	type DesktopPhotoOriginalTransportCurrentV1, type DesktopPhotoOriginalWritableCurrentV1 } from './desktop-photo-original-contract-current-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted, SLICE = Blob.prototype.slice, ARRAY_BUFFER = Blob.prototype.arrayBuffer;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, NAME = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;
const DOM_NAME = Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')!.get!;
const FILL = Uint8Array.prototype.fill, SET = Uint8Array.prototype.set;
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')!.get!;
const STAGING_DIRECTORY = 'lightscaper-desktop-original-staging-v1';

/** Private unique stage. Retirement never runs concurrently with materialize;
 * its owner joins that operation first, including a held native write. */
export class DesktopPhotoOriginalStageCurrentV1 {
	#parent: DesktopPhotoOriginalDirectoryCurrentV1 | undefined;
	#name: string | undefined;
	#owned = false;
	#writer: DesktopPhotoOriginalWritableCurrentV1 | undefined;
	#writerNeedsAbort = false;
	#closing: Promise<void> | undefined;

	async materialize(storage: DesktopPhotoOriginalStorageCurrentV1, createId: () => string,
		transport: Readonly<Pick<DesktopPhotoOriginalTransportCurrentV1, 'read'>>, ticket: Readonly<DesktopPhotoOriginalTicketCurrentV1>, signal: AbortSignal): Promise<File> {
		check(signal); const root = await storage.getDirectory(); check(signal);
		this.#parent = await root.getDirectoryHandle(STAGING_DIRECTORY, { create: true }); check(signal);
		const token = createId();
		if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(token)) throw new TypeError('Original staging requires an owned random directory ID.');
		this.#name = `original-${token}`;
		try { await this.#parent.getDirectoryHandle(this.#name, { create: false }); throw new Error('Original staging directory already exists.'); }
		catch (error) { if (!notFound(error)) throw error; }
		check(signal); const directory = await this.#parent.getDirectoryHandle(this.#name, { create: true }); this.#owned = true; check(signal);
		const handle = await directory.getFileHandle('body.bin', { create: true }); check(signal);
		this.#writer = await handle.createWritable({ keepExistingData: false }); this.#writerNeedsAbort = true; check(signal);
		for (let offset = 0; offset < ticket.original.byteLength;) {
			check(signal); const length = Math.min(LIMITS.rangeBytes, ticket.original.byteLength - offset);
			const value = await transport.read(ticket, offset, length); check(signal);
			const bytes = copy(value, length);
			try { await this.#writer.write(bytes); check(signal); }
			finally { Reflect.apply(FILL, bytes, [0]); }
			offset += length;
		}
		check(signal); await this.#writer.close(); this.#writerNeedsAbort = false; check(signal);
		const value = await handle.getFile(); check(signal);
		if (Reflect.apply(SIZE, value, []) !== ticket.original.byteLength || Reflect.apply(NAME, value, []) !== 'body.bin') throw new Error('Staged Original is not the exact native File.');
		const file = value as File;
		if (await digest(file, signal) !== ticket.original.contentSha256) throw new Error('Staged Original SHA-256 differs from its native binding.');
		check(signal); return file;
	}

	retire(reason?: unknown): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closing = Promise.resolve().then(async () => {
			if (this.#writerNeedsAbort && this.#writer) {
				await this.#writer.abort(reason); this.#writerNeedsAbort = false;
			}
			if (this.#owned && this.#parent && this.#name) {
				try { await this.#parent.removeEntry(this.#name, { recursive: true }); }
				catch (error) { if (!notFound(error)) throw error; }
				this.#owned = false;
			}
		});
		return this.#closing;
	}
}
function copy(value: unknown, length: number): Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array) || Reflect.apply(BYTE_LENGTH, value, []) !== length) throw new RangeError('Native Original pull differs from its exact bounded interval.');
	const bytes = new Uint8Array(length); Reflect.apply(SET, bytes, [value]); return bytes;
}
async function digest(file: File, signal: AbortSignal): Promise<string> {
	const size = Reflect.apply(SIZE, file, []) as number, hash = sha256.create();
	try {
		for (let offset = 0; offset < size; offset += LIMITS.rangeBytes) {
			check(signal); const length = Math.min(LIMITS.rangeBytes, size - offset);
			const slice = Reflect.apply(SLICE, file, [offset, offset + length]) as Blob;
			const buffer = await Reflect.apply(ARRAY_BUFFER, slice, []) as ArrayBuffer;
			const bytes = new Uint8Array(buffer);
			try {
				check(signal); if (bytes.byteLength !== length) throw new Error('Native staged Original hash read differs from its exact interval.'); hash.update(bytes);
			} finally { Reflect.apply(FILL, bytes, [0]); }
		}
		const bytes = hash.digest(); try { return bytesToHex(bytes); } finally { Reflect.apply(FILL, bytes, [0]); }
	} finally { hash.destroy(); }
}
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
function notFound(value: unknown): boolean { try { return Reflect.apply(DOM_NAME, value, []) === 'NotFoundError'; } catch { return false; } }
