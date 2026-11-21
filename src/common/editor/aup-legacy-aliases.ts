/* SPDX-License-Identifier: AGPL-3.0-only */

import { LegacyAupError } from './aup-legacy-xml.ts';
import { inspectAiffBlobPcm, createAiffBlobPcmChunkReader } from './aiff-pcm-chunk-reader.ts';
import { inspectWavBlobPcm } from './wav-import.js';
import { createWavBlobPcmChunkReader, type WavBlobPcmSource } from './wav-pcm-chunk-reader.ts';
import { ascii, readBlobBytes } from './wav-import-io.ts';

const CHUNK_FRAMES = 4096;

interface AliasRange {
	readonly filename: string;
	readonly startFrame: number;
	readonly frameCount: number;
	readonly channel: number;
}

export interface LegacyAliasPlacement extends AliasRange {
	readonly destinationOffset: number;
	readonly clipPlan: { samples: Float32Array };
}

interface LegacyAliasReadOptions {
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
	readonly admitReadBytes: (byteLength: number) => void;
	readonly onPlacement: (filename: string) => void;
}

export function readLegacyAliasRange(name: unknown, start: unknown, length: unknown, channel: unknown): AliasRange {
	const filename = typeof name === 'string' ? name.trim() : '';
	const startFrame = aliasInteger(start);
	const frameCount = aliasInteger(length);
	const channelIndex = aliasInteger(channel);
	if (!filename || startFrame === null || frameCount === null || frameCount < 1 || channelIndex === null
		|| !Number.isSafeInteger(startFrame + frameCount)) throw invalidRange(filename);
	return { filename, startFrame, frameCount, channel: channelIndex };
}

/** Copy authorized PCM ranges into the existing mono wave-block placements. */
export async function readLegacyAliasPlacements(file: Blob, placements: readonly LegacyAliasPlacement[], options: LegacyAliasReadOptions): Promise<void> {
	const filename = placements[0]!.filename;
	const source: WavBlobPcmSource = {
		size: file.size,
		slice(start, end) {
			return { arrayBuffer: async () => {
				options.signal?.throwIfAborted();
				options.assertCurrent?.();
				options.admitReadBytes(end - start);
				return file.slice(start, end).arrayBuffer();
			} };
		},
	};
	const signature = ascii(await readBlobBytes(source as Blob, 0, Math.min(source.size, 4), options.signal), 0, Math.min(source.size, 4));
	const readOptions = options.signal ? { signal: options.signal } : {};
	const reader = await openPcmReader(source, signature, filename, readOptions);
	const { frameCount, channelCount } = reader.descriptor;
	for (const placement of placements) {
		if (placement.channel >= channelCount || placement.startFrame + placement.frameCount > frameCount) {
			throw invalidRange(placement.filename);
		}
	}
	let chunk: Awaited<ReturnType<typeof reader.readChunk>> | undefined;
	for (const placement of placements) {
		const end = placement.startFrame + placement.frameCount;
		let frame = placement.startFrame;
		while (frame < end) {
			options.signal?.throwIfAborted();
			options.assertCurrent?.();
			const index = Math.floor(frame / reader.chunkFrames);
			if (chunk?.index !== index) chunk = await reader.readChunk(index, readOptions);
			options.assertCurrent?.();
			const offset = frame - chunk.frameOffset;
			const frames = Math.min(end - frame, chunk.frames - offset);
			placement.clipPlan.samples.set(chunk.channels[placement.channel]!.subarray(offset, offset + frames),
				placement.destinationOffset + frame - placement.startFrame);
			frame += frames;
		}
		options.onPlacement(placement.filename);
	}
}

async function openPcmReader(source: WavBlobPcmSource, signature: string, filename: string, options: Readonly<{ signal?: AbortSignal }>) {
	if (signature === 'FORM') {
		const descriptor = await inspectAiffBlobPcm(source, options);
		return createAiffBlobPcmChunkReader(source, { descriptor, chunkFrames: CHUNK_FRAMES });
	}
	if (['RIFF', 'RF64', 'BW64'].includes(signature)) {
		const descriptor = await inspectWavBlobPcm(source, options);
		return createWavBlobPcmChunkReader(source, { descriptor, chunkFrames: CHUNK_FRAMES });
	}
	throw new LegacyAupError(`The aliased audio file ${filename} must contain WAV or AIFF PCM.`, 'UNSUPPORTED_ALIAS_FORMAT', { filename });
}

function aliasInteger(value: unknown): number | null {
	if (typeof value !== 'string' || !/^\d+$/u.test(value.trim())) return null;
	const converted = Number(value);
	return Number.isSafeInteger(converted) ? converted : null;
}

function invalidRange(filename: string): LegacyAupError {
	return new LegacyAupError(`The Audacity alias for ${filename || 'this file'} has an invalid sample range or channel.`, 'INVALID_ALIAS_RANGE', { filename });
}
