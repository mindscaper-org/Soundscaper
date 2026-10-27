/* SPDX-License-Identifier: AGPL-3.0-only */

import { id3ValidationFailure as failure, id3FieldForFrame } from './id3-validation-failure.ts';
import { ID3_DESCRIPTIVE_FIELDS } from './id3-descriptive-fields.ts';
import { decodeArtworkData, parseId3Artwork } from './id3-artwork.ts';

const encoder = new TextEncoder();
export const ID3_TEXT_FRAME_IDS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries([
	...ID3_DESCRIPTIVE_FIELDS.filter(field => field.kind === 'text' || field.kind === 'pairs' || field.kind === 'url')
		.map(field => [normalizeId3Key(field.key), field.frame]),
	['track', 'TRCK'], ['year', 'TDRC'], ['disc', 'TPOS'],
]));
export const ID3_CANONICAL_FRAME_KEYS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
	ID3_DESCRIPTIVE_FIELDS.filter(field => field.kind === 'text' || field.kind === 'pairs' || field.kind === 'url')
		.map(field => [field.frame, field.key])));
export const ID3_CONTROL_KEYS = new Set(['commentlanguage', 'commentdescription', 'lyricslanguage', 'lyricsdescription',
	'termslanguage', 'id3artwork', 'identifierowner', 'ratingemail']);
for (const key of ['ownershipprice', 'ownershipdate', 'commercialvaliduntil', 'commercialcontacturl',
	'commercialreceivedas', 'commercialseller', 'commercialdescription', 'synchronizedlyricslanguage', 'synchronizedlyricsdescription']) ID3_CONTROL_KEYS.add(key);

export function normalizeId3Key(key: string): string { return key.toLowerCase().replace(/[^a-z0-9]/gu, ''); }

export function id3FramePayload(id: string, value: string, field = id3FieldForFrame(id)): Uint8Array<ArrayBuffer> {
	if (id.startsWith('W')) {
		let url: URL;
		try { url = new URL(value); } catch (error) {
			if (!(error instanceof Error)) throw error;
			throw failure(error, 'id3Url', field);
		}
		if (!['https:', 'http:', 'mailto:', 'ftp:'].includes(url.protocol)) throw failure(new RangeError('Unsupported metadata URL scheme.'), 'id3Url', field);
		return encoder.encode(url.href);
	}
	if (id === 'TIPL' || id === 'TMCL') {
		const pairs = value.split(/\r?\n/u).filter(Boolean).flatMap(line => {
			const split = line.indexOf('=');
			if (split < 1 || split === line.length - 1) throw failure(new RangeError('Credits require one role=name pair per line.'), 'id3Credits', field);
			return [line.slice(0, split).trim(), line.slice(split + 1).trim()];
		});
		return joinId3Bytes(Uint8Array.of(3), encoder.encode(pairs.join('\0')));
	}
	return joinId3Bytes(Uint8Array.of(3), encoder.encode(value));
}

export function structuredId3Payload(key: string, value: string, metadata: Readonly<Record<string, string>>): Readonly<{ id: string; payload: Uint8Array<ArrayBuffer> }> | null {
	if (key === 'ownershipseller') {
		return { id: 'OWNE', payload: joinId3Bytes(Uint8Array.of(3), asciiPrice(metadata.ownershipPrice || '', 'ownershipPrice'), Uint8Array.of(0),
			compactDate(metadata.ownershipDate || '', 'ownershipDate'), encoder.encode(value)) };
	}
	if (key === 'commercialprice') {
		const received = Number(metadata.commercialReceivedAs || '0');
		if (!Number.isInteger(received) || received < 0 || received > 8) throw failure(new RangeError('Commercial received-as must be 0–8.'), 'id3Range', 'commercialReceivedAs', { minimum: 0, maximum: 8 });
		const contact = id3FramePayload('WCOM', metadata.commercialContactUrl || '', 'commercialContactUrl');
		return { id: 'COMR', payload: joinId3Bytes(Uint8Array.of(3), asciiPrice(value, 'commercialPrice'), Uint8Array.of(0),
			compactDate(metadata.commercialValidUntil || '', 'commercialValidUntil'), contact, Uint8Array.of(0, received),
			encoder.encode(metadata.commercialSeller || ''), Uint8Array.of(0), encoder.encode(metadata.commercialDescription || ''), Uint8Array.of(0, 0)) };
	}
	if (key === 'synchronizedlyrics') {
		const language = metadata.synchronizedLyricsLanguage || 'eng';
		if (!/^[a-z]{3}$/u.test(language)) throw failure(new RangeError('Timed lyrics require an ISO 639-2 language code.'), 'id3Language', 'synchronizedLyricsLanguage');
		const lines = value.split(/\r?\n/u).filter(Boolean).map(line => {
			const match = /^\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\](.*)$/u.exec(line);
			if (!match) throw failure(new RangeError('Timed lyrics require [mm:ss.xxx] text on each line.'), 'id3TimedLyrics', 'synchronizedLyrics');
			const milliseconds = Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number((match[3] || '').padEnd(3, '0'));
			if (!Number.isSafeInteger(milliseconds) || milliseconds > 0xffff_ffff) throw failure(new RangeError('A lyric timestamp exceeds the ID3 limit.'), 'id3Timestamp', 'synchronizedLyrics', { maximum: 0xffff_ffff });
			const time = new Uint8Array(4);
			new DataView(time.buffer).setUint32(0, milliseconds);
			return joinId3Bytes(encoder.encode(match[4]), Uint8Array.of(0), time);
		});
		return { id: 'SYLT', payload: joinId3Bytes(Uint8Array.of(3), encoder.encode(language), Uint8Array.of(2, 1),
			encoder.encode(metadata.synchronizedLyricsDescription || ''), Uint8Array.of(0), ...lines) };
	}
	if (key === 'comment' || key === 'comments' || key === 'lyrics' || key === 'termsofuse') {
		const prefix = key === 'lyrics' ? 'lyrics' : key === 'termsofuse' ? 'terms' : 'comment';
		const language = metadata[`${prefix}Language`] || 'eng';
		if (!/^[a-z]{3}$/u.test(language)) throw failure(new RangeError('ID3 text language requires an ISO 639-2 code.'), 'id3Language', `${prefix}Language`);
		const id = prefix === 'lyrics' ? 'USLT' : prefix === 'terms' ? 'USER' : 'COMM';
		return { id, payload: joinId3Bytes(Uint8Array.of(3), encoder.encode(language),
			...(id === 'USER' ? [] : [encoder.encode(metadata[`${prefix}Description`] || ''), Uint8Array.of(0)]), encoder.encode(value)) };
	}
	if (key === 'uniqueidentifier') {
		const owner = metadata.identifierOwner;
		if (!owner || /[^\x20-\x7e]/u.test(owner)) throw failure(new RangeError('A unique identifier requires an ASCII owner URL.'), 'id3AsciiOwner', 'identifierOwner');
		const bytes = encoder.encode(value);
		if (bytes.length > 64) throw failure(new RangeError('A unique identifier supports at most 64 bytes.'), 'id3Bytes', 'uniqueIdentifier', { maximum: 64 });
		return { id: 'UFID', payload: joinId3Bytes(encoder.encode(owner), Uint8Array.of(0), bytes) };
	}
	if (key === 'playcount') return { id: 'PCNT', payload: counter(value) };
	if (key === 'rating') {
		const rating = Number(value);
		if (!Number.isInteger(rating) || rating < 0 || rating > 255) throw failure(new RangeError('ID3 rating must be 0–255.'), 'id3Range', 'rating', { minimum: 0, maximum: 255 });
		const email = metadata.ratingEmail || '';
		if (/[^\x20-\x7e]/u.test(email)) throw failure(new RangeError('ID3 rating email must be ASCII.'), 'id3Ascii', 'ratingEmail');
		return { id: 'POPM', payload: joinId3Bytes(encoder.encode(email), Uint8Array.of(0, rating), counter(metadata.playCount || '0')) };
	}
	return null;
}

function asciiPrice(value: string, field: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Z]{3}\d+(?:\.\d+)?(?:\/[A-Z]{3}\d+(?:\.\d+)?)*$/u.test(value)) throw failure(new RangeError('A price requires a currency code and amount, for example EUR12.99.'), 'id3Price', field);
	return encoder.encode(value);
}

function compactDate(value: string, field: string): Uint8Array<ArrayBuffer> {
	if (!/^\d{8}$/u.test(value)) throw failure(new RangeError('An ownership or offer date requires YYYYMMDD.'), 'id3Date', field);
	const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}T00:00:00Z`);
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10).replaceAll('-', '') !== value) throw failure(new RangeError('Invalid ownership or offer date.'), 'id3Date', field);
	return encoder.encode(value);
}

export function id3ArtworkFrames(metadata: Readonly<Record<string, string>>): readonly Uint8Array<ArrayBuffer>[] {
	return parseId3Artwork(metadata.id3Artwork).map(picture => createId3Frame('APIC', joinId3Bytes(
		Uint8Array.of(3), encoder.encode(picture.mimeType), Uint8Array.of(0, picture.pictureType),
		encoder.encode(picture.description), Uint8Array.of(0), decodeArtworkData(picture.data),
	)));
}

export function createId3Frame(id: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(10 + payload.length);
	bytes.set(encoder.encode(id));
	bytes.set(id3Synchsafe(payload.length), 4);
	bytes.set(payload, 10);
	return bytes;
}

export function id3Synchsafe(value: number): Uint8Array<ArrayBuffer> {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fff_ffff) throw failure(new RangeError('ID3 metadata is too large.'), 'id3TooLarge', '');
	return Uint8Array.of((value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127);
}

export function joinId3Bytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) { bytes.set(part, offset); offset += part.length; }
	return bytes;
}

function counter(value: string): Uint8Array<ArrayBuffer> {
	if (!/^\d{1,20}$/u.test(value)) throw failure(new RangeError('Play count must be a non-negative integer.'), 'id3Counter', 'playCount');
	let count = BigInt(value);
	const bytes: number[] = [];
	do { bytes.unshift(Number(count & 255n)); count >>= 8n; } while (count);
	while (bytes.length < 4) bytes.unshift(0);
	return Uint8Array.from(bytes);
}
