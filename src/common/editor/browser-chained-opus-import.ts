/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortableRead } from '../foundation/abort-race.ts';
import type { PreparedStreamedAudioImport, StreamedAudioImportDescriptor, StreamedAudioImportStreamOptions } from './browser-streamed-audio-import.ts';
import { LARGE_AUDIO_DURATION_SECONDS } from './large-audio-policy.ts';
import { ChainedOpusAudioError } from './chained-opus-audio-error.ts';
import { inspectOggGaplessGeometry } from './ogg-gapless-import.ts';
import { oggPageCrc } from './ogg-page-crc.ts';
import { normalizePcmChunkFrames } from './storage/pcm-chunk-geometry.ts';

const SAMPLE_RATE = 48_000;
const MAXIMUM_LINKS = 4096;
const MAXIMUM_SCAN_PAGES = 1_000_000;
const MAXIMUM_HEADER_BYTES = 27 + 255;

interface Link { readonly start: number; readonly end: number; readonly frames: number }

/** Each link is an independent Opus stream and must start with fresh decoder state. */
export async function prepareChainedOpusAudioImport(file: Blob, desktop: boolean,
	prepareLink: (file: Blob, signal: AbortSignal) => Promise<PreparedStreamedAudioImport>, signal?: AbortSignal,
): Promise<PreparedStreamedAudioImport> {
	const { links, channelCount, frameCount } = await inspectLinks(file, desktop, signal);
	const descriptor: StreamedAudioImportDescriptor = Object.freeze({ container: 'compressed-audio',
		sampleRate: SAMPLE_RATE, channelCount, frameCount, mimeType: file.type || 'audio/ogg',
	});
	const lifetime = new AbortController();
	const dispose = (): void => lifetime.abort();
	let started = false;
	return Object.freeze({ descriptor, dispose, async stream(settings: StreamedAudioImportStreamOptions) {
		if (started || lifetime.signal.aborted) throw new Error('The compressed audio import decoder is closed.');
		started = true;
		const signals = [lifetime.signal, signal, settings.signal].filter(value => value !== undefined);
		const current = AbortSignal.any(signals);
		try {
			const { append, finish } = createOutputChunks(settings, current, channelCount);
			for (const link of links) {
				current.throwIfAborted();
				settings.assertCurrent?.();
				const prepared = await prepareLink(file.slice(link.start, link.end, descriptor.mimeType), current);
				try {
					const actual = prepared.descriptor;
					if (actual.sampleRate !== SAMPLE_RATE || actual.channelCount !== channelCount || actual.frameCount !== link.frames) {
						throw new RangeError('Decoded Ogg Opus link geometry differs from its authenticated stream.');
					}
					await prepared.stream({ ...settings, signal: current, onChunk: append });
				} finally { prepared.dispose(); }
			}
			await finish();
		} finally { dispose(); }
	} });
}

/** Authenticate a contiguous audio-only chain before admitting any PCM writes. */
async function inspectLinks(file: Blob, desktop: boolean, signal?: AbortSignal) {
	const links: Link[] = [];
	const serials = new Set<number>();
	let channelCount = 0, frameCount = 0;
	let start = 0, serial = 0, sequence = 0, continued = false;
	for (let offset = 0, count = 0; offset < file.size; count++) {
		signal?.throwIfAborted();
		if (count >= MAXIMUM_SCAN_PAGES || links.length >= MAXIMUM_LINKS) throw new RangeError('The chained Opus source exceeds its bounded link or page count.');
		const header = new Uint8Array(await file.slice(offset, offset + MAXIMUM_HEADER_BYTES).arrayBuffer());
		signal?.throwIfAborted();
		if (header.length < 27 || String.fromCharCode(...header.subarray(0, 4)) !== 'OggS' || header[4]) throw new ChainedOpusAudioError();
		const flags = header[5]!;
		const laces = header.subarray(27, 27 + header[26]!);
		const end = offset + 27 + laces.length + laces.reduce((sum, length) => sum + length, 0);
		if (flags & ~7 || laces.length !== header[26] || end > file.size) throw new ChainedOpusAudioError();
		const page = new Uint8Array(await file.slice(offset, end).arrayBuffer());
		signal?.throwIfAborted();
		const view = new DataView(page.buffer);
		if (view.getUint32(22, true) !== oggPageCrc(page)) throw new Error('The Ogg source page checksum failed.');
		const pageSerial = view.getUint32(14, true);
		if (view.getUint32(18, true) !== sequence) throw new ChainedOpusAudioError();
		if (sequence === 0) {
			const body = page.subarray(27 + laces.length);
			const channels = body[9];
			if (flags !== 2 || laces.length !== 1 || body.length !== 19 || serials.has(pageSerial)
				|| String.fromCharCode(...body.subarray(0, 8)) !== 'OpusHead' || body[8] !== 1 || body[18] !== 0
				|| channels !== 1 && channels !== 2 || channelCount && channels !== channelCount) throw new ChainedOpusAudioError();
			channelCount = channels;
			serial = pageSerial;
			serials.add(serial);
		} else if (pageSerial !== serial || flags & 2 || Boolean(flags & 1) !== continued) throw new ChainedOpusAudioError();
		continued = laces.at(-1) === 255;
		sequence++;
		if (flags & 4) {
			if (continued) throw new ChainedOpusAudioError();
			const geometry = await inspectOggGaplessGeometry(file.slice(start, end), 'opus', signal);
			if (!geometry) throw new ChainedOpusAudioError();
			frameCount += geometry.sourceFrames;
			if (!Number.isSafeInteger(frameCount * channelCount * 4)) throw new RangeError('The compressed audio source frame count is unsupported.');
			if (!desktop && frameCount > LARGE_AUDIO_DURATION_SECONDS * SAMPLE_RATE) {
				throw new RangeError('The compressed audio source exceeds the one-hour import duration limit.');
			}
			links.push({ start, end, frames: geometry.sourceFrames });
			start = end;
			sequence = 0;
		}
		offset = end;
	}
	signal?.throwIfAborted();
	if (sequence || links.length < 2) throw new ChainedOpusAudioError();
	return { links, channelCount, frameCount };
}

/** Preserve the normal fixed-size storage blocks across unaligned link ends. */
function createOutputChunks(settings: StreamedAudioImportStreamOptions, signal: AbortSignal, channelCount: number) {
	const chunkFrames = normalizePcmChunkFrames(settings.chunkFrames);
	let chunk: Float32Array[] | null = null;
	let used = 0;
	async function emit(channels: Float32Array[]): Promise<void> {
		signal.throwIfAborted();
		settings.assertCurrent?.();
		await raceAbortableRead(() => settings.onChunk(channels), signal);
		signal.throwIfAborted();
		settings.assertCurrent?.();
	}
	return {
		async append(channels: Float32Array[]): Promise<void> {
			const frames = channels[0]!.length;
			if (!used && frames === chunkFrames) return emit(channels);
			for (let offset = 0; offset < frames;) {
				chunk ??= Array.from({ length: channelCount }, () => new Float32Array(chunkFrames));
				const framesToCopy = Math.min(frames - offset, chunkFrames - used);
				for (let channel = 0; channel < channelCount; channel++) {
					chunk[channel]!.set(channels[channel]!.subarray(offset, offset + framesToCopy), used);
				}
				offset += framesToCopy;
				used += framesToCopy;
				if (used === chunkFrames) {
					await emit(chunk);
					chunk = null;
					used = 0;
				}
			}
		},
		async finish(): Promise<void> { if (chunk) await emit(chunk.map(channel => channel.subarray(0, used))); },
	};
}
