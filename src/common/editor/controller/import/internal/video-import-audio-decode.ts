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
	readonly nativeContextSampleRate?: number;
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
	const {
		assertDecodedVideoAudioWorkload, assertMinimumVideoAudioWindow, planVideoAudioWorkload,
		readVideoAudioWorkload, VideoAudioOutputLimitError, VideoAudioWholeFileLimitError,
	} = await import('./video-import-audio-workload.ts');
	throwIfAborted(options.signal);
	assertMinimumVideoAudioWindow(options.durationSeconds, options.projectSampleRate);
	let audioOffsetSeconds = 0, durationSeconds = options.durationSeconds, audioTrackCount = 0;
	let nativeTimingShared = true;
	try {
		const timing = await readVideoContainerAudioTiming(options.file, options.signal);
		audioOffsetSeconds = timing.offsetSeconds;
		audioTrackCount = timing.audioTrackCount;
		nativeTimingShared = timing.nativeTimingShared;
		if (timing.programmeEndSeconds !== null) durationSeconds = Math.max(durationSeconds, timing.programmeEndSeconds);
	} catch { throwIfAborted(options.signal); }
	const workload = await readVideoAudioWorkload(options.file, options.signal);
	if (workload?.presentationEndSeconds != null) durationSeconds = Math.max(
		options.durationSeconds, Math.min(durationSeconds, workload.presentationEndSeconds),
	);
	const programmeFor = (duration: number) => duration > options.durationSeconds
		? { programmeFrameCount: secondsToSampleFrame(duration, options.projectSampleRate, 'point') } : {};
	let programme = programmeFor(durationSeconds);
	const budgetDurationSeconds = workload ? durationSeconds : options.durationSeconds;
	const nativeRate = options.nativeContextSampleRate ?? options.projectSampleRate;
	const plan = planVideoAudioWorkload(workload, budgetDurationSeconds, options.projectSampleRate, nativeRate);
	let nativeWholeFile = nativeTimingShared && plan.nativeWholeFile;
	// Native engines choose different programmes. Every possible choice must fit
	// and share its authored endpoint before whole-file decoding is admitted.
	if (nativeWholeFile && audioTrackCount > 1) {
		nativeWholeFile = audioTrackCount <= 32;
		for (let index = 0; nativeWholeFile && index < audioTrackCount; index++) {
			const candidate = await readVideoAudioWorkload(options.file, options.signal, index);
			if (!candidate || candidate.presentationEndSeconds == null
				|| candidate.presentationEndSeconds !== workload?.presentationEndSeconds) {
				nativeWholeFile = false;
				break;
			}
			try {
				nativeWholeFile = planVideoAudioWorkload(candidate, durationSeconds, options.projectSampleRate, nativeRate).nativeWholeFile;
			} catch { nativeWholeFile = false; }
		}
	}
	let declaredAudioSampleRate: number | null = null;
	try {
		// Native decoders select different tracks across engines. Keep their path
		// only for shared timing; the container sink explicitly selects primary.
		if (!nativeWholeFile) throw new VideoAudioWholeFileLimitError();
		if (options.file.size > 32 * 1024 * 1024) throw new RangeError('Use bounded container audio decoding.');
		const encoded = await options.file.arrayBuffer();
		declaredAudioSampleRate = audioTrackCount > 1 ? null : options.inspectEncodedSampleRate(encoded);
		const decodedAudio = await options.decodeNative(encoded);
		throwIfAborted(options.signal);
		assertDecodedVideoAudioWorkload(decodedAudio, budgetDurationSeconds, options.projectSampleRate, audioOffsetSeconds);
		return Object.freeze({
			decodedAudio: placeImportedVideoAudio(decodedAudio, audioOffsetSeconds, durationSeconds),
			declaredAudioSampleRate, ...programme,
		});
	} catch (error) {
		throwIfAborted(options.signal);
		if (workload && audioTrackCount <= 1 && error instanceof VideoAudioOutputLimitError) throw error;
		const forbidWholeFileFallback = workload !== null && audioTrackCount <= 1 && nativeWholeFile
			&& error instanceof VideoAudioWholeFileLimitError;
		try {
			const decodedAudio = await (options.decodeContainerAudio ?? decodeBrowserContainerAudio)(options.file, {
				signal: options.signal, durationSeconds,
			});
			throwIfAborted(options.signal);
			assertDecodedVideoAudioWorkload(decodedAudio, budgetDurationSeconds, options.projectSampleRate);
			return Object.freeze({
				decodedAudio,
				declaredAudioSampleRate, ...programme,
			});
		} catch (error) {
			throwIfAborted(options.signal);
			if (workload && (error instanceof VideoAudioOutputLimitError || error instanceof VideoAudioWholeFileLimitError)) throw error;
			let firstWorkload = workload;
			if (audioTrackCount > 1) {
				// Both maintained FFmpeg routes explicitly map 0:a:0, independent of
				// container defaults. Its offset and source extent belong to that track.
				const first = await readVideoContainerAudioTiming(options.file, options.signal, 'first');
				audioOffsetSeconds = first.offsetSeconds;
				durationSeconds = Math.max(options.durationSeconds, first.programmeEndSeconds ?? 0);
				firstWorkload = await readVideoAudioWorkload(options.file, options.signal, 'first');
				if (firstWorkload?.presentationEndSeconds != null) durationSeconds = Math.max(
					options.durationSeconds, Math.min(durationSeconds, firstWorkload.presentationEndSeconds),
				);
				programme = programmeFor(durationSeconds);
			}
			assertMinimumVideoAudioWindow(durationSeconds, options.projectSampleRate);
			if (forbidWholeFileFallback || !planVideoAudioWorkload(firstWorkload, durationSeconds,
				options.projectSampleRate, nativeRate).ffmpegWholeFile) throw new VideoAudioWholeFileLimitError();
			const decodedAudio = await options.decodeFfmpeg(options.file, {
				sampleRate: options.projectSampleRate, signal: options.signal,
			});
			throwIfAborted(options.signal);
			assertDecodedVideoAudioWorkload(decodedAudio, durationSeconds, options.projectSampleRate, audioOffsetSeconds);
			return Object.freeze({
				decodedAudio: placeImportedVideoAudio(decodedAudio, audioOffsetSeconds, durationSeconds),
				declaredAudioSampleRate, ...programme,
			});
		}
	}
}
