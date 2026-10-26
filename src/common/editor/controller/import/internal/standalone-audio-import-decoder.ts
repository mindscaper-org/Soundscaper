/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDesktopMainAudioCodecRuntime } from '../../../desktop-main-audio-codec-runtime-marker.ts';
import { raceAbortableRead } from '../../../abort-race.ts';
import { prepareNativeRiffAudioDecode } from '../../../native-riff-audio-padding.ts';

interface StandaloneAudioFile {
	arrayBuffer(): Promise<ArrayBuffer>;
}

interface CodecDecodedAudio {
	readonly channels: readonly Float32Array[];
	readonly sampleRate: number;
}

interface DecodedAudio {
	readonly sampleRate: number;
}

interface StandaloneAudioImportDecodeOptions<
	File extends StandaloneAudioFile,
	Context,
	Decoded extends DecodedAudio,
> {
	readonly file: File;
	readonly codecRuntime: unknown;
	readonly sampleRate: number;
	readonly signal?: AbortSignal;
	readonly getAudioContext: () => Promise<Context>;
	readonly decodeWithWebAudio: (
		encoded: ArrayBuffer,
		decodedSampleRate: number | null,
	) => Promise<Decoded>;
	readonly decodeWithCodec: (
		file: File,
		settings: Readonly<{ sampleRate: number; signal?: AbortSignal }>,
	) => Promise<CodecDecodedAudio>;
	readonly bufferFromChannels: (
		channels: readonly Float32Array[],
		sampleRate: number,
		context: Context,
	) => Promise<Decoded>;
	readonly inspectEncodedSampleRate: (encoded: ArrayBuffer) => number | null;
	/**
	 * The rate the file's own decoder emits, where the container states it
	 * unambiguously. Native decoding is pinned to it so the browser does not
	 * resample the import to the output device's rate; containers that only
	 * declare a core rate report null and decode unpinned.
	 */
	readonly inspectDecodedSampleRate: (encoded: ArrayBuffer) => number | null;
}

export interface StandaloneAudioImportDecodeResult<Context, Decoded extends DecodedAudio> {
	readonly context: Context;
	readonly decoded: Decoded;
	readonly originalSampleRate: number | null;
}

export async function decodeStandaloneAudioForImport<
	File extends StandaloneAudioFile,
	Context,
	Decoded extends DecodedAudio,
>(options: StandaloneAudioImportDecodeOptions<File, Context, Decoded>): Promise<
	StandaloneAudioImportDecodeResult<Context, Decoded>
> {
	options.signal?.throwIfAborted();
	const codecSettings = { sampleRate: options.sampleRate, ...(options.signal ? { signal: options.signal } : {}) };
	if (isDesktopMainAudioCodecRuntime(options.codecRuntime)) {
		const codec = await raceAbortableRead(() => options.decodeWithCodec(options.file, codecSettings), options.signal);
		const context = await raceAbortableRead(() => options.getAudioContext(), options.signal);
		const decoded = await raceAbortableRead(() => options.bufferFromChannels(codec.channels, codec.sampleRate, context), options.signal);
		const inspectedSampleRate = await inspectOriginalSampleRate(options);
		return Object.freeze({
			context,
			decoded,
			originalSampleRate: inspectedSampleRate ?? codec.sampleRate,
		});
	}

	const context = await raceAbortableRead(() => options.getAudioContext(), options.signal);
	let originalSampleRate: number | null = null;
	try {
		const encoded = await raceAbortableRead(() => options.file.arrayBuffer(), options.signal);
		originalSampleRate = options.inspectEncodedSampleRate(encoded);
		const decoded = await raceAbortableRead(() => options.decodeWithWebAudio(prepareNativeRiffAudioDecode(encoded), options.inspectDecodedSampleRate(encoded)), options.signal);
		return Object.freeze({ context, decoded, originalSampleRate });
	} catch {
		options.signal?.throwIfAborted();
		const codec = await raceAbortableRead(() => options.decodeWithCodec(options.file, codecSettings), options.signal);
		const decoded = await raceAbortableRead(() => options.bufferFromChannels(codec.channels, codec.sampleRate, context), options.signal);
		return Object.freeze({
			context,
			decoded,
			originalSampleRate: originalSampleRate ?? codec.sampleRate,
		});
	}
}

async function inspectOriginalSampleRate<
	File extends StandaloneAudioFile,
	Context,
	Decoded extends DecodedAudio,
>(options: StandaloneAudioImportDecodeOptions<File, Context, Decoded>): Promise<number | null> {
	try {
		return options.inspectEncodedSampleRate(await raceAbortableRead(() => options.file.arrayBuffer(), options.signal));
	} catch {
		options.signal?.throwIfAborted();
		return null;
	}
}
