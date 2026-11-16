/* SPDX-License-Identifier: AGPL-3.0-only */
import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { parseAdlDocument } from './aes31-import.ts';
import type { AdlExportResult } from './aes31-export.ts';
import type { TimelineInterchangeDocument } from './timeline-interchange-types.ts';

const MAXIMUM_BYTES = 512 * 1024 * 1024;
export interface AdlPackageFile { readonly path: string; readonly stream: ReadableStream<Uint8Array> }

/** ZIP is a transport wrapper; the contained .adl and BWF files are ordinary AES31 assets. */
export async function writeAdlPackage(result: AdlExportResult, files: AsyncIterable<AdlPackageFile>,
	destination?: WritableStream<Uint8Array>, signal?: AbortSignal): Promise<Blob | null> {
	const writer = new ZipWriter(destination ?? new BlobWriter('application/zip'));
	try {
		signal?.throwIfAborted();
		await writer.add(result.fileName, new TextReader(result.text), { signal });
		const expected = new Set(result.media.map(file => file.path));
		for await (const file of files) {
			if (!expected.delete(file.path)) throw new TypeError('Unexpected or duplicate ADL package member.');
			await writer.add(file.path, file.stream, { level: 0, signal });
		}
		if (expected.size) throw new Error('ADL package media is incomplete.');
		const output: unknown = await writer.close();
		signal?.throwIfAborted();
		return output instanceof Blob ? output : null;
	} catch (error) {
		await writer.close().catch(() => undefined);
		throw error;
	}
}

export async function readAdlPackage(blob: Blob, signal?: AbortSignal): Promise<TimelineInterchangeDocument> {
	if (blob.size > MAXIMUM_BYTES) throw new RangeError('ADL package exceeds its 512 MiB import limit.');
	const reader = new ZipReader(new BlobReader(blob));
	try {
		signal?.throwIfAborted();
		const entries = await reader.getEntries();
		if (entries.length > 10_000) throw new RangeError('ADL package entry count exceeds its limit.');
		const seen = new Set<string>();
		let total = 0;
		for (const entry of entries) {
			const name = safePath(entry.filename, entry.directory);
			if (seen.has(name)) throw new TypeError('Duplicate ADL package entry.');
			seen.add(name);
			total += entry.uncompressedSize;
			if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || total > MAXIMUM_BYTES) throw new RangeError('ADL package expanded bytes exceed its limit.');
		}
		const lists = entries.filter(entry => !entry.directory && /\.adl$/iu.test(entry.filename));
		if (lists.length !== 1) throw new TypeError('An ADL package must contain exactly one ADL.');
		const list = lists[0]!;
		if (list.uncompressedSize > 32 * 1024 * 1024) throw new RangeError('ADL text exceeds its import limit.');
		const extract = async (entry: (typeof entries)[number]): Promise<Blob> => {
			if (!('getData' in entry) || !entry.getData) throw new TypeError('Unreadable ADL package entry.');
			let bytes = 0;
			const chunks: Uint8Array<ArrayBuffer>[] = [];
			await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
				signal?.throwIfAborted(); bytes += chunk.length;
				if (bytes > entry.uncompressedSize || bytes > MAXIMUM_BYTES) throw new RangeError('ADL package entry exceeds its declared size.');
				chunks.push(new Uint8Array(chunk));
			} }), { signal, checkSignature: true });
			if (bytes !== entry.uncompressedSize) throw new RangeError('ADL package entry is truncated.');
			return new Blob(chunks);
		};
		const document = parseAdlDocument(await (await extract(list)).text());
		const directory = list.filename.slice(0, list.filename.lastIndexOf('/') + 1);
		const media = [];
		const extracted = new Map<string, Blob>();
		for (const reference of document.media) {
			signal?.throwIfAborted();
			let path = reference.path.replace(/^file:(?:\/\/localhost\/)?/iu, '').replaceAll('\\', '/');
			try { path = decodeURIComponent(path); } catch { throw new TypeError('Invalid ADL media locator.'); }
			const relative = !path.startsWith('/') && !/^[a-z]:/iu.test(path) && !path.includes('://') && !path.split('/').includes('..');
			const exact = relative ? entries.find(entry => entry.filename === directory + path) : undefined;
			const basename = path.split('/').at(-1);
			const matches = entries.filter(entry => !entry.directory && entry.filename.split('/').at(-1) === basename);
			const entry = exact ?? (matches.length === 1 ? matches[0] : undefined);
			let body = entry && extracted.get(entry.filename);
			if (entry && !body) { body = await extract(entry); extracted.set(entry.filename, body); }
			media.push({ ...reference, ...(body ? { blob: body } : {}) });
		}
		return { ...document, media };
	} finally { await reader.close(); }
}

function safePath(path: string, directory: boolean): string {
	const normalized = directory ? path.replace(/\/$/u, '') : path;
	if (!normalized || path.length > 4096 || /[\\:]/u.test(path) || Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
		|| normalized.split('/').some(part => !part || part === '.' || part === '..')) throw new TypeError('Unsafe ADL package member path.');
	return path;
}
