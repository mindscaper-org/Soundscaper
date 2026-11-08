/* SPDX-License-Identifier: AGPL-3.0-only */

import { readDesktopLightscaperArchiveOpenDescriptorCurrentV1,
	type DesktopLightscaperArchiveOpenDescriptorCurrentV1 } from '../common/editor/desktop-lightscaper-archive-open-contract-current-v1.ts';

export const DESKTOP_PHOTO_ARCHIVE_RANGE_BYTES_CURRENT_V1 = 4 * 1024 * 1024;
const STAGING_DIRECTORY = 'lightscaper-desktop-archive-staging-v1';
const CHECK = AbortSignal.prototype.throwIfAborted;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const NAME = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;

interface ArchiveWritable {
	write(bytes: Uint8Array<ArrayBuffer>): PromiseLike<unknown>;
	close(): PromiseLike<unknown>;
	abort(reason?: unknown): PromiseLike<unknown>;
}
interface ArchiveFileHandle {
	createWritable(options: Readonly<{ keepExistingData: false }>): PromiseLike<ArchiveWritable>;
	getFile(): PromiseLike<File>;
}
export interface DesktopPhotoArchiveDirectoryCurrentV1 {
	getDirectoryHandle(name: string, options: Readonly<{ create: boolean }>): PromiseLike<DesktopPhotoArchiveDirectoryCurrentV1>;
	getFileHandle(name: string, options: Readonly<{ create: boolean }>): PromiseLike<ArchiveFileHandle>;
	removeEntry(name: string, options: Readonly<{ recursive: true }>): PromiseLike<void>;
}
interface ArchiveResponse {
	readonly status: number;
	readonly redirected: boolean;
	readonly url: string;
	readonly headers: Readonly<{ get(name: string): string | null }>;
	readonly body: ReadableStream<Uint8Array<ArrayBuffer>> | null;
}
export type DesktopPhotoArchiveFetchCurrentV1 = (url: string, options: Readonly<{
	method: 'GET'; headers: Readonly<{ Range: string }>; signal?: AbortSignal;
	cache: 'no-store'; credentials: 'omit'; redirect: 'error';
}>) => PromiseLike<ArchiveResponse>;
export interface DesktopPhotoArchiveFileOptionsCurrentV1 {
	readonly finishArchive: (request: Readonly<{ id: string }>) => void | PromiseLike<void>;
	readonly signal?: AbortSignal;
	readonly fetch?: DesktopPhotoArchiveFetchCurrentV1;
	readonly storage?: Readonly<{ getDirectory(): PromiseLike<DesktopPhotoArchiveDirectoryCurrentV1> }>;
	readonly createId?: () => string;
}
export interface DesktopPhotoArchiveFileCurrentV1 {
	readonly file: File;
	/** Caller first joins every restore/read consumer, including cancellation.
	 * This barrier then deletes only this materialization's owned OPFS stage. */
	close(): Promise<void>;
}

/** Materialize one native-selected range grant without renderer-resident archive
 * assembly. Transfer owns its readers/writer and retires the native grant before
 * returning. The returned real File is retained until its consumer joins close. */
export async function materializeDesktopPhotoArchiveFileCurrentV1(
	value: unknown, options: DesktopPhotoArchiveFileOptionsCurrentV1,
): Promise<Readonly<DesktopPhotoArchiveFileCurrentV1>> {
	// Capture only an inert capability ID before full admission, so a valid issued
	// grant is released even when its remaining descriptor or signal is refused.
	const id = releaseId(value), failures: unknown[] = [];
	let parent: DesktopPhotoArchiveDirectoryCurrentV1 | undefined, name: string | undefined;
	let owned = false, writer: ArchiveWritable | undefined, writerNeedsAbort = false, file: File | undefined;
	let closeWork: Promise<void> | undefined;
	const close = (): Promise<void> => {
		closeWork ??= Promise.resolve().then(async () => {
			if (!owned || !parent || !name) return;
			try { await parent.removeEntry(name, { recursive: true }); }
			catch (error) { if (!notFound(error)) throw error; }
			owned = false;
		});
		return closeWork;
	};
	try {
		const descriptor = readDesktopLightscaperArchiveOpenDescriptorCurrentV1(value);
		if (descriptor.id !== id) throw new TypeError('Photo archive capability identity changed during admission.');
		if (descriptor.size < 1) throw new RangeError('Photo archive opening requires a nonempty selected file.');
		check(options.signal);
		const storage = options.storage ?? globalThis.navigator?.storage;
		if (!storage?.getDirectory) throw new Error('Photo archive opening requires native OPFS staging.');
		const root = await storage.getDirectory(); check(options.signal);
		parent = await root.getDirectoryHandle(STAGING_DIRECTORY, { create: true }); check(options.signal);
		const token = options.createId ? options.createId() : crypto.randomUUID();
		if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(token)) throw new TypeError('Photo archive staging requires an owned random directory ID.');
		name = `incoming-${token}`;
		try { await parent.getDirectoryHandle(name, { create: false }); throw new Error('Photo archive staging directory already exists.'); }
		catch (error) { if (!notFound(error)) throw error; }
		check(options.signal);
		const directory = await parent.getDirectoryHandle(name, { create: true }); owned = true; check(options.signal);
		const handle = await directory.getFileHandle(descriptor.name, { create: true }); check(options.signal);
		writer = await handle.createWritable({ keepExistingData: false }); writerNeedsAbort = true; check(options.signal);
		const fetcher: DesktopPhotoArchiveFetchCurrentV1 = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
		for (let offset = 0; offset < descriptor.size;) {
			check(options.signal);
			const length = Math.min(DESKTOP_PHOTO_ARCHIVE_RANGE_BYTES_CURRENT_V1, descriptor.size - offset);
			await transferRange(descriptor, offset, length, writer, fetcher, options.signal);
			offset += length;
		}
		check(options.signal); await writer.close(); writerNeedsAbort = false; check(options.signal);
		file = await handle.getFile(); check(options.signal);
		if (Reflect.apply(SIZE, file, []) !== descriptor.size || Reflect.apply(NAME, file, []) !== descriptor.name) {
			throw new Error('Native staged Photo archive File differs from its selected source.');
		}
	} catch (error) { remember(failures, error); }
	finally {
		if (writerNeedsAbort && writer) {
			try { await writer.abort(failures[0]); writerNeedsAbort = false; }
			catch (error) { remember(failures, error); }
		}
		// transferRange never returns before its native response reader terminates.
		try { await options.finishArchive(Object.freeze({ id })); }
		catch (error) { remember(failures, error); }
	}
	if (failures.length) {
		// An abort refusal cannot prove the writable released its owned file.
		if (!writerNeedsAbort) { try { await close(); } catch (error) { remember(failures, error); } }
		throw failure(failures, 'Photo archive materialization or retirement failed.');
	}
	if (!file) throw new Error('Photo archive materialization has no native File.');
	return Object.freeze({ file, close });
}

async function transferRange(descriptor: Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1>, start: number, length: number,
	writer: ArchiveWritable, fetcher: DesktopPhotoArchiveFetchCurrentV1, signal?: AbortSignal): Promise<void> {
	const end = start + length - 1;
	let response: ArchiveResponse;
	try { response = await fetcher(descriptor.url, { method: 'GET', headers: Object.freeze({ Range: `bytes=${start}-${end}` }),
		cache: 'no-store', credentials: 'omit', redirect: 'error', ...(signal ? { signal } : {}) }); }
	catch (error) { check(signal); throw error; }
	if (!response.body) { check(signal); throw new Error('Photo archive range has no native response body.'); }
	const reader = response.body.getReader(), failures: unknown[] = [];
	let ended = false, terminal = false, cancelling: Promise<void> | undefined;
	// closed is a terminal witness, not a second owner of an already observed
	// read error. Keep its rejection handled while an OPFS write is pending.
	const closed = reader.closed.then(() => { terminal = true; }, () => { terminal = true; });
	const cancel = (reason?: unknown): Promise<void> => {
		if (terminal && !cancelling) return Promise.resolve();
		cancelling ??= Promise.resolve().then(() => reader.cancel(reason));
		void cancelling.catch(() => undefined); return cancelling;
	};
	const aborted = () => { void cancel(signal ? Reflect.apply(REASON, signal, []) : undefined); };
	try {
		if (signal) signal.addEventListener('abort', aborted, { once: true });
		check(signal);
		if (response.status !== 206 || response.redirected || (response.url !== '' && response.url !== descriptor.url)
			|| response.headers.get('Content-Range') !== `bytes ${start}-${end}/${descriptor.size}`
			|| response.headers.get('Content-Length') !== String(length)) throw new Error('Photo archive range response differs from its exact admitted interval.');
		let written = 0;
		for (;;) {
			check(signal);
			const part = await reader.read(); check(signal);
			if (part.done) { ended = true; break; }
			if (!(part.value instanceof Uint8Array) || part.value.byteLength < 1 || part.value.byteLength > length - written) {
				throw new Error('Photo archive range body exceeds its exact byte length.');
			}
			await writer.write(part.value); written += part.value.byteLength; check(signal);
		}
		if (written !== length) throw new Error('Photo archive range body was truncated.');
	} catch (error) {
		try { check(signal); remember(failures, error); }
		catch (reason) { remember(failures, reason); }
	}
	finally {
		if (signal) signal.removeEventListener('abort', aborted);
		if (cancelling || !ended) { try { await (cancelling ?? cancel(failures[0])); } catch (error) { remember(failures, error); } }
		await closed;
		try { reader.releaseLock(); } catch (error) { remember(failures, error); }
	}
	if (failures.length) throw failure(failures, 'Photo archive range read or retirement failed.');
}

function releaseId(value: unknown): string {
	if (!value || typeof value !== 'object') throw new TypeError('Photo archive opening requires its native capability descriptor.');
	const field = Object.getOwnPropertyDescriptor(value, 'id');
	if (!field || !Object.hasOwn(field, 'value') || typeof field.value !== 'string' || !/^[a-f0-9]{64}$/u.test(field.value)) {
		throw new TypeError('Photo archive opening requires an inert native capability ID.');
	}
	return field.value;
}
function notFound(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'NotFoundError';
}
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }
function remember(errors: unknown[], value: unknown): void { if (!errors.some(error => Object.is(error, value))) errors.push(value); }
function failure(errors: readonly unknown[], label: string): unknown { return errors.length === 1 ? errors[0] : new AggregateError(errors, label, { cause: errors[0] }); }
