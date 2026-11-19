/* SPDX-License-Identifier: AGPL-3.0-only */

import { BlobReader, BlobWriter, ZipReader, type FileEntry } from '@zip.js/zip.js/index-native.js';
import { parseSoundcraftDocument } from './soundcraft-import.ts';
import type { TimelineInterchangeDocument } from './timeline-interchange-types.ts';

const MAXIMUM_ENTRIES = 4096;
const MAXIMUM_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAXIMUM_MEDIA_BYTES = 512 * 1024 * 1024;
const MAXIMUM_SESSION_BYTES = 32 * 1024 * 1024;

export interface SoundcraftBundle {
	readonly document: TimelineInterchangeDocument;
	readMedia(path: string): Promise<Blob | null>;
	close(): Promise<void>;
}

/** Read media on demand, with archive admission before any payload is inflated. */
export async function openSoundcraftBundle(blob: Blob, signal?: AbortSignal): Promise<SoundcraftBundle> {
	signal?.throwIfAborted();
	const reader = new ZipReader(new BlobReader(blob));
	try {
		const entries = new Map<string, FileEntry>();
		let count = 0, total = 0;
		for await (const entry of reader.getEntriesGenerator()) {
			signal?.throwIfAborted();
			if (++count > MAXIMUM_ENTRIES) throw new RangeError('SoundCraft bundle entry limit exceeded.');
			const path = safePath(entry.filename.replace(/\/$/u, ''));
			if (!path) throw new TypeError('Unsafe SoundCraft bundle path.');
			if (entry.directory) continue;
			if (entries.has(path)) throw new SyntaxError('Duplicate SoundCraft bundle path.');
			if (entry.encrypted) throw new TypeError('Encrypted SoundCraft bundles are unsupported.');
			total += entry.uncompressedSize;
			if (!Number.isSafeInteger(total) || total > MAXIMUM_TOTAL_BYTES || entry.uncompressedSize > MAXIMUM_MEDIA_BYTES) {
				throw new RangeError('SoundCraft bundle expanded byte limit exceeded.');
			}
			entries.set(path, entry);
		}
		const sessions = [...entries.keys()].filter(path => !path.includes('/') && /\.scraft$/iu.test(path));
		if (sessions.length !== 1) throw new SyntaxError('A SoundCraft bundle requires exactly one root session.');
		let closed = false;
		const read = async (path: string, limit: number): Promise<Blob | null> => {
			signal?.throwIfAborted();
			if (closed) throw new Error('The SoundCraft bundle is closed.');
			const entry = entries.get(path);
			if (!entry) return null;
			if (entry.uncompressedSize > limit) throw new RangeError('SoundCraft bundle entry byte limit exceeded.');
			const data = await entry.getData(new BlobWriter(), { signal, checkSignature: true, useWebWorkers: false });
			if (data.size !== entry.uncompressedSize) throw new Error('SoundCraft bundle entry size mismatch.');
			return data;
		};
		const session = (await read(sessions[0]!, MAXIMUM_SESSION_BYTES))!;
		const document = parseSoundcraftDocument(new TextDecoder('utf-8', { fatal: true }).decode(await session.arrayBuffer()));
		return { document, readMedia: path => read(safePath(path) ?? '', MAXIMUM_MEDIA_BYTES),
			async close() { if (closed) return; closed = true; await reader.close(); } };
	} catch (error) {
		await reader.close();
		throw error;
	}
}

function safePath(value: string): string | null {
	if (value.length > 4096 || value.includes('\\') || value.includes(':')
		|| Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null;
	const parts = value.split('/');
	return parts.length <= 32 && parts.every(part => part && part !== '.' && part !== '..' && part.length <= 255) ? value : null;
}
