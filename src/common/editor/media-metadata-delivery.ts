/* SPDX-License-Identifier: AGPL-3.0-only */

import { roundRational } from './timeline-time.ts';

const MAX_LONG_METADATA_VALUE_LENGTH = 65_536;

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
