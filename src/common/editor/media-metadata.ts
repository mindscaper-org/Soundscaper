/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseId3Artwork } from './id3-artwork.ts';
import { roundRational } from './timeline-time.ts';

const MAX_METADATA_FIELDS = 128;
const MAX_METADATA_VALUE_LENGTH = 4096;
const MAX_LONG_METADATA_VALUE_LENGTH = 65_536;

export function normalizeMediaMetadata(value: unknown = {}): Readonly<Record<string, string>> {
	if (value == null) return Object.freeze({});
	if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Export metadata must be an object.');
	const entries = Object.entries(value).filter(([, item]) => item != null && String(item) !== '');
	if (entries.length > MAX_METADATA_FIELDS) throw new RangeError(`Export metadata supports at most ${MAX_METADATA_FIELDS} fields.`);
	const result: Record<string, string> = {};
	for (const [rawKey, rawValue] of entries) {
		const key = String(rawKey).trim();
		if (!/^[A-Za-z0-9_. -]{1,64}$/.test(key)) throw new RangeError(`Invalid metadata field name: ${rawKey}.`);
		const standardKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
		const text = String(rawValue);
		// eslint-disable-next-line no-control-regex
		if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new RangeError(`Metadata field ${key} contains control characters.`);
		if (standardKey === 'id3artwork') parseId3Artwork(text);
		const maximumLength = standardKey === 'id3artwork' ? 12 * 1024 * 1024
			: standardKey === 'lyrics' || standardKey === 'synchronizedlyrics' || standardKey === 'termsofuse' ? MAX_LONG_METADATA_VALUE_LENGTH : MAX_METADATA_VALUE_LENGTH;
		if (text.length > maximumLength) throw new RangeError(`Metadata field ${key} is too long.`);
		Object.defineProperty(result, key, {
			value: text, enumerable: true, writable: true, configurable: true,
		});
	}
	return Object.freeze(result);
}

interface MetadataRange { readonly startFrame: number; readonly endFrame: number; }
interface MetadataSegment {
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly outputStartFrame: number;
}
interface TimedLyric { readonly milliseconds: number; readonly text: string; }

/** Compile once; chapters and repeated regions query the same bounded lyric index. */
export function createMediaMetadataDelivery(metadata: Readonly<Record<string, string>>, inputSampleRate: number, outputSampleRate: number) {
	const fields = Object.entries(metadata).flatMap(([key, value]) => {
		if (key.toLowerCase().replace(/[^a-z0-9]/gu, '') !== 'synchronizedlyrics') return [];
		const lyrics = parseTimedLyrics(value);
		return lyrics ? [{ key, lyrics: lyrics.sort((a, b) => a.milliseconds - b.milliseconds) }] : [];
	});
	return (range: MetadataRange | null, sequence?: readonly MetadataSegment[]): Readonly<Record<string, string>> => {
		if (fields.length === 0 || (!range && !sequence)) return metadata;
		const segments = sequence ?? [{ sourceStartFrame: range!.startFrame, sourceEndFrame: range!.endFrame, outputStartFrame: 0 }];
		const result = { ...metadata }, inputRate = BigInt(inputSampleRate), outputRate = BigInt(outputSampleRate);
		for (const { key, lyrics } of fields) {
			const lines: string[] = []; let length = 0;
			for (const segment of segments) {
				const start = BigInt(segment.sourceStartFrame) * 1000n, end = BigInt(segment.sourceEndFrame) * 1000n;
				for (let index = lyricIndex(lyrics, start, inputRate); index < lyrics.length; index++) {
					const lyric = lyrics[index]!, position = BigInt(lyric.milliseconds) * inputRate;
					if (position >= end) break;
					const milliseconds = BigInt(roundRational((position - start) * outputRate
						+ BigInt(segment.outputStartFrame) * 1000n * inputRate, inputRate * outputRate, 'point'));
					const line = `[${String(milliseconds / 60_000n).padStart(2, '0')}:${String(milliseconds / 1000n % 60n).padStart(2, '0')}.${String(milliseconds % 1000n).padStart(3, '0')}]${lyric.text}`;
					length += line.length + (lines.length ? 1 : 0);
					if (length > MAX_LONG_METADATA_VALUE_LENGTH) throw new RangeError(`Metadata field ${key} is too long.`);
					lines.push(line);
				}
			}
			if (lines.length) result[key] = lines.join('\n');
			else delete result[key];
		}
		return Object.freeze(result);
	};
}

function parseTimedLyrics(value: string): TimedLyric[] | null {
	const lyrics: TimedLyric[] = [];
	for (const line of value.split(/\r?\n/u).filter(Boolean)) {
		const match = /^\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\](.*)$/u.exec(line);
		if (!match) return null; // The owning ID3 encoder retains its localized admission error.
		const milliseconds = Number(match[1]) * 60_000 + Number(match[2]) * 1000 + Number((match[3] ?? '').padEnd(3, '0'));
		if (!Number.isSafeInteger(milliseconds) || milliseconds > 0xffff_ffff) return null;
		lyrics.push({ milliseconds, text: match[4]! });
	}
	return lyrics;
}

function lyricIndex(lyrics: readonly TimedLyric[], start: bigint, rate: bigint): number {
	let low = 0, high = lyrics.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (BigInt(lyrics[middle]!.milliseconds) * rate < start) low = middle + 1;
		else high = middle;
	}
	return low;
}
