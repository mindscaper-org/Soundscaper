/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	decodeBrowserContainerAudio,
	type BrowserContainerAudioDecodeOptions,
} from '../../../browser-container-audio-decode.ts';
import { secondsToSampleFrame } from '../../../timeline-time.ts';
import { throwIfAborted } from '../../../video-timing-demux-reader.ts';
import { readContainerVideoSourceCharacteristics } from '../../../video-container-characteristics.ts';
import { placeImportedVideoAudio, readVideoContainerAudioTiming } from './video-import-audio-timing.ts';

export type ImportedVideoDecodedAudio = ImportedVideoPlanarAudio | ImportedVideoAudioBuffer;

export interface ImportedVideoPlanarAudio {
	readonly channels: readonly Float32Array[];
	readonly numberOfChannels?: never;
	readonly sampleRate: number;
}

export interface ImportedVideoAudioBuffer {
	readonly channels?: never;
	readonly numberOfChannels: number;
	readonly sampleRate: number;
	getChannelData(channel: number): Float32Array;
}

interface ImportedVideoAudioDecodeOptions {
	readonly file: Blob;
	readonly projectSampleRate: number;
	readonly durationSeconds: number;
	readonly hasAudio?: boolean;
	readonly signal?: AbortSignal;
	readonly inspectEncodedSampleRate: (encoded: ArrayBuffer) => number | null;
	readonly decodeNative: (encoded: ArrayBuffer) => Promise<ImportedVideoDecodedAudio>;
	readonly decodeContainerAudio?: (
		file: Blob,
		options: BrowserContainerAudioDecodeOptions,
	) => Promise<ImportedVideoDecodedAudio>;
	readonly decodeFfmpeg: (
		file: Blob,
		options: Readonly<{ sampleRate: number; signal?: AbortSignal }>,
	) => Promise<ImportedVideoDecodedAudio>;
}

export interface ImportedVideoAudioDecodeResult {
	readonly decodedAudio: ImportedVideoDecodedAudio;
	readonly declaredAudioSampleRate: number | null;
	readonly programmeFrameCount?: number;
}

/** Prefer Web Audio, then the container decoder, before leasing the standalone codec. */
export async function decodeImportedVideoAudio(
	options: ImportedVideoAudioDecodeOptions,
): Promise<ImportedVideoAudioDecodeResult> {
	throwIfAborted(options.signal);
	let hasAudio = options.hasAudio;
	if (hasAudio === undefined) {
		try {
			const characteristics = await readContainerVideoSourceCharacteristics(options.file, { signal: options.signal });
			hasAudio = characteristics.audioStreams?.some(() => true);
		} catch { throwIfAborted(options.signal); }
	}
	// A reported empty track inventory is authoritative. Some browsers never
	// settle decodeAudioData for a video-only MP4, and silence is not an error.
	if (hasAudio === false) return Object.freeze({
		decodedAudio: { channels: [], sampleRate: options.projectSampleRate },
		declaredAudioSampleRate: null,
	});
	let audioOffsetSeconds = 0, durationSeconds = options.durationSeconds;
	try {
		const timing = await readVideoContainerAudioTiming(options.file, options.signal);
		audioOffsetSeconds = timing.offsetSeconds;
		if (timing.programmeEndSeconds !== null) durationSeconds = Math.max(durationSeconds, timing.programmeEndSeconds);
	} catch { throwIfAborted(options.signal); }
	const programme = durationSeconds > options.durationSeconds
		? { programmeFrameCount: secondsToSampleFrame(durationSeconds, options.projectSampleRate, 'point') } : {};
	let declaredAudioSampleRate: number | null = null;
	try {
		if (options.file.size > 32 * 1024 * 1024) throw new RangeError('Use bounded container audio decoding.');
		const encoded = await options.file.arrayBuffer();
		declaredAudioSampleRate = options.inspectEncodedSampleRate(encoded);
		return Object.freeze({
			decodedAudio: placeImportedVideoAudio(await options.decodeNative(encoded), audioOffsetSeconds, durationSeconds),
			declaredAudioSampleRate, ...programme,
		});
	} catch {
		try {
			return Object.freeze({
				decodedAudio: await (options.decodeContainerAudio ?? decodeBrowserContainerAudio)(options.file, {
					signal: options.signal,
					durationSeconds,
				}),
				declaredAudioSampleRate, ...programme,
			});
		} catch {
			throwIfAborted(options.signal);
			return Object.freeze({
				decodedAudio: placeImportedVideoAudio(await options.decodeFfmpeg(options.file, {
					sampleRate: options.projectSampleRate,
					signal: options.signal,
				}), audioOffsetSeconds, durationSeconds),
				declaredAudioSampleRate, ...programme,
			});
		}
	}
}
