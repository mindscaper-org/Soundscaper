/* SPDX-License-Identifier: AGPL-3.0-only */

import { decodeAiffMetadataText } from './aiff-metadata-text.ts';
import { readImportedMetadataTags } from './imported-metadata-reader.ts';

const MAXIMUM_METADATA_ARRAY_LENGTH = 512;
const MAXIMUM_AIFF_CHUNKS = 4_096;
const MAXIMUM_AIFF_METADATA_CHUNK_BYTES = 4 * 1024 * 1024;
// One ID3 tag can contain the admitted 8 MiB artwork plus text and frame headers.
const MAXIMUM_AIFF_ID3_CHUNK_BYTES = 17 * 1024 * 1024;
const MAC_EPOCH_TO_UNIX_SECONDS = 2_082_844_800;

interface AiffInspection {
	readonly tags: Readonly<Record<string, unknown>>;
	readonly namespaces: Readonly<Record<string, unknown>>;
	readonly warnings: readonly string[];
}

export async function inspectAiffMetadata(file: Blob, signal?: AbortSignal): Promise<AiffInspection | null> {
	if (file.size < 12) return null;
	const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	signal?.throwIfAborted();
	if (ascii(header, 0, 4) !== 'FORM' || !['AIFF', 'AIFC'].includes(ascii(header, 8, 12))) return null;
	const raw: Record<string, unknown> = {};
	const annotations: string[] = [];
	const comments: Readonly<Record<string, unknown>>[] = [];
	const embeddedId3: Record<string, unknown>[] = [];
	const warnings: string[] = [];
	let title: string | undefined;
	let artist: string | undefined;
	let copyright: string | undefined;
	let offset = 12;
	let chunkCount = 0;
	let metadataBytes = 0;
	let aggregateLimitReported = false;
	while (offset + 8 <= file.size && chunkCount < MAXIMUM_AIFF_CHUNKS) {
		signal?.throwIfAborted();
		const chunkHeader = new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
		const id = ascii(chunkHeader, 0, 4);
		const size = new DataView(chunkHeader.buffer, chunkHeader.byteOffset, chunkHeader.byteLength).getUint32(4, false);
		const dataStart = offset + 8;
		const dataEnd = Math.min(file.size, dataStart + size);
		if (['NAME', 'AUTH', '(c) ', 'ANNO', 'COMT', 'ID3 '].includes(id)) {
			const maximumBytes = id === 'ID3 ' ? MAXIMUM_AIFF_ID3_CHUNK_BYTES : MAXIMUM_AIFF_METADATA_CHUNK_BYTES;
			if (size > maximumBytes) {
				warnings.push(
					`AIFF ${id.trim()} metadata chunk exceeded ${String(maximumBytes)} bytes and was omitted.`,
				);
			} else if (size > MAXIMUM_AIFF_ID3_CHUNK_BYTES - metadataBytes) {
				if (!aggregateLimitReported) warnings.push('AIFF optional metadata exceeded its aggregate 17 MiB byte limit; additional fields were omitted.');
				aggregateLimitReported = true;
			} else {
				metadataBytes += size;
				const bytes = new Uint8Array(await file.slice(dataStart, dataEnd).arrayBuffer());
				if (id === 'ID3 ') {
					const rawKey = Object.hasOwn(raw, id) ? `${id}[${String(chunkCount)}]` : id;
					raw[rawKey] = bytes;
					try {
						const parsed = dataRecord(await readImportedMetadataTags(aiffId3Wave(bytes), signal));
						if (parsed) {
							const id3Index = embeddedId3.length;
							embeddedId3.push(parsed);
							const parsedRaw = dataRecord(ownDataValue(parsed, 'raw'));
							const parsedPrefix = id3Index === 0 ? 'ID3' : `ID3[${String(id3Index)}]`;
							for (const key of Object.keys(parsedRaw ?? {}).sort()) {
								Object.defineProperty(raw, `${parsedPrefix}.${key}`, {
									value: ownDataValue(parsedRaw, key),
									enumerable: true,
									writable: true,
									configurable: true,
								});
							}
						}
					} catch {
						// The complete bounded chunk remains available as a hashed attachment.
					}
				}
				else if (id === 'COMT') comments.push(...parseAiffComments(bytes));
				else {
					const text = decodeAiffMetadataText(bytes);
					const rawKey = Object.hasOwn(raw, id) ? `${id}[${String(chunkCount)}]` : id;
					raw[rawKey] = text;
					if (id === 'NAME' && title === undefined) title = text;
					if (id === 'AUTH' && artist === undefined) artist = text;
					if (id === '(c) ' && copyright === undefined) copyright = text;
					if (id === 'ANNO') annotations.push(text);
				}
			}
		}
		const nextOffset = dataStart + size + size % 2;
		if (nextOffset <= offset) break;
		offset = nextOffset;
		chunkCount += 1;
	}
	const firstId3 = embeddedId3[0];
	const images: unknown[] = [];
	for (const tags of embeddedId3) {
		const pictures = ownDataValue(tags, 'images');
		if (Array.isArray(pictures)) images.push(...pictures.slice(0, MAXIMUM_METADATA_ARRAY_LENGTH + 1 - images.length));
		if (images.length > MAXIMUM_METADATA_ARRAY_LENGTH) break;
	}
	const normalized = {
		...(firstId3 ?? {}),
		...(images.length ? { images } : {}),
		...(title || stringValue(ownDataValue(firstId3 ?? null, 'title'))
			? { title: title ?? stringValue(ownDataValue(firstId3 ?? null, 'title')) } : {}),
		...(artist || stringValue(ownDataValue(firstId3 ?? null, 'artist'))
			? { artist: artist ?? stringValue(ownDataValue(firstId3 ?? null, 'artist')) } : {}),
		...(annotations.length || stringValue(ownDataValue(firstId3 ?? null, 'comment'))
			? { comment: annotations.length
				? annotations.join('\n') : stringValue(ownDataValue(firstId3 ?? null, 'comment')) } : {}),
		raw,
	};
	return Object.freeze({
		tags: Object.freeze(normalized),
			namespaces: Object.freeze({
				aiff: Object.freeze({
				...(copyright ? { copyright } : {}),
				...(annotations.length ? { annotations: Object.freeze(annotations) } : {}),
					...(comments.length ? { comments: Object.freeze(comments) } : {}),
					...(embeddedId3.length ? {
						id3: embeddedId3.length === 1 ? embeddedId3[0] : Object.freeze(embeddedId3),
					} : {}),
				}),
			}),
		warnings: Object.freeze(warnings),
	});
}

/** Wrap an AIFF ID3 payload in the smallest valid WAVE container Mediabunny can inspect. */
function aiffId3Wave(tag: Uint8Array): Blob {
	const paddedTagLength = tag.byteLength + tag.byteLength % 2;
	const id3ChunkLength = 8 + paddedTagLength;
	const bytes = new Uint8Array(12 + 24 + id3ChunkLength + 10);
	const view = new DataView(bytes.buffer);
	writeAscii(bytes, 0, 'RIFF');
	view.setUint32(4, bytes.byteLength - 8, true);
	writeAscii(bytes, 8, 'WAVE');
	writeAscii(bytes, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 8_000, true);
	view.setUint32(28, 16_000, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeAscii(bytes, 36, 'ID3 ');
	view.setUint32(40, tag.byteLength, true);
	bytes.set(tag, 44);
	const dataOffset = 44 + paddedTagLength;
	writeAscii(bytes, dataOffset, 'data');
	view.setUint32(dataOffset + 4, 2, true);
	return new Blob([bytes], { type: 'audio/wav' });
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		bytes[offset + index] = value.charCodeAt(index);
	}
}

function parseAiffComments(bytes: Uint8Array): Readonly<Record<string, unknown>>[] {
	if (bytes.byteLength < 2) return [];
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint16(0, false);
	const comments: Readonly<Record<string, unknown>>[] = [];
	let offset = 2;
	for (let index = 0; index < count && offset + 8 <= bytes.byteLength; index += 1) {
		const timestamp = view.getUint32(offset, false);
		const markerId = view.getUint16(offset + 4, false);
		const textLength = view.getUint16(offset + 6, false);
		const textStart = offset + 8;
		const textEnd = textStart + textLength;
		if (textEnd > bytes.byteLength) break;
		const unixMilliseconds = (timestamp - MAC_EPOCH_TO_UNIX_SECONDS) * 1_000;
		const date = new Date(unixMilliseconds);
		comments.push(Object.freeze({
			timestamp: Number.isNaN(date.getTime()) ? String(timestamp) : date.toISOString(),
			markerId,
			text: decodeAiffMetadataText(bytes.subarray(textStart, textEnd)),
		}));
		offset = textEnd + textLength % 2;
	}
	return comments;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.subarray(start, end));
}

function dataRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function ownDataValue(record: Record<string, unknown> | null, key: string): unknown {
	if (!record) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value ? value : undefined;
}
