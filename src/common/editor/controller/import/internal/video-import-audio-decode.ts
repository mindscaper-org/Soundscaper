/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortableRead } from '../../../../foundation/abort-race.ts';
import {
	decodeBrowserContainerAudio,
	type BrowserContainerAudioDecodeOptions,
} from '../../../browser-container-audio-decode.ts';
import { scaleSampleFrame, secondsToSampleFrame } from '../../../timeline-time.ts';
import { throwIfAborted } from '../../../video-timing-demux-reader.ts';
import { readContainerVideoSourceCharacteristics } from '../../../video-container-characteristics.ts';
import { placeImportedVideoAudio, readVideoContainerAudioTiming } from './video-import-audio-timing.ts';

const NATIVE_VIDEO_AUDIO_DECODE_TIMEOUT_MS = 15_000;

export type ImportedVideoDecodedAudio = ImportedVideoPlanarAudio | ImportedVideoAudioBuffer;

export interface ImportedVideoPlanarAudio {
	readonly channels: readonly Float32Array[];
	readonly numberOfChannels?: never;
	readonly sampleRate: number;
	readonly programmeFrameCount?: number;
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
	/** Thin archives can require a saved stream index or the original decode policy. */
	readonly audioProgramme?: number | 'legacy';
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
	readonly selectedAudioStreamIndex?: number;
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
		createVideoAudioWorkloadReader, VideoAudioOutputLimitError, VideoAudioWholeFileLimitError,
	} = await import('./video-import-audio-workload.ts');
	throwIfAborted(options.signal);
	assertMinimumVideoAudioWindow(options.durationSeconds, options.projectSampleRate);
	let audioOffsetSeconds = 0, durationSeconds = options.durationSeconds, audioTrackCount = 0;
	let nativeTimingShared = true;
	let packetDecodePreferred = false;
	let selectedAudioTrack: Awaited<ReturnType<typeof readVideoContainerAudioTiming>>['selectedAudioTrack'];
	let selectedEndSeconds: number | null = null;
	try {
		const timing = await readVideoContainerAudioTiming(options.file, options.signal,
			options.audioProgramme === 'legacy' ? 'legacy-primary' : 'primary');
		audioOffsetSeconds = timing.offsetSeconds;
		audioTrackCount = timing.audioTrackCount;
		nativeTimingShared = timing.nativeTimingShared;
		packetDecodePreferred = timing.packetDecodePreferred === true;
		selectedAudioTrack = timing.selectedAudioTrack;
		if (selectedAudioTrack) selectedEndSeconds = timing.programmeEndSeconds;
		if (timing.programmeEndSeconds !== null) durationSeconds = Math.max(durationSeconds, timing.programmeEndSeconds);
	} catch { throwIfAborted(options.signal); }
	if (typeof options.audioProgramme === 'number' && selectedAudioTrack?.streamIndex !== options.audioProgramme) {
		throw new Error('External audio does not report its recorded container stream.');
	}
	const workloadReader = await createVideoAudioWorkloadReader(options.file, options.signal);
	const decodeFile = selectedAudioTrack?.file ?? options.file;
	try {
		const workload = await workloadReader.read(selectedAudioTrack?.ordinal);
		if (selectedAudioTrack && workload?.presentationEndSeconds != null) {
			selectedEndSeconds = Math.min(selectedEndSeconds ?? Infinity, workload.presentationEndSeconds);
		}
		if (workload?.presentationEndSeconds != null) durationSeconds = Math.max(
			options.durationSeconds, Math.min(durationSeconds, workload.presentationEndSeconds),
		);
		const programmeFor = (duration: number) => duration > options.durationSeconds
			? { programmeFrameCount: secondsToSampleFrame(duration, options.projectSampleRate, 'point') } : {};
		let programme = programmeFor(durationSeconds);
		const budgetDurationSeconds = workload ? durationSeconds : options.durationSeconds;
		const nativeRate = options.nativeContextSampleRate ?? options.projectSampleRate;
		const plan = planVideoAudioWorkload(workload, budgetDurationSeconds, options.projectSampleRate, nativeRate);
		let nativeWholeFile = (nativeTimingShared || Boolean(selectedAudioTrack)) && plan.nativeWholeFile && !packetDecodePreferred;
		// Native engines choose different programmes. Every possible choice must fit
		// and share its authored endpoint before whole-file decoding is admitted.
		if (nativeWholeFile && audioTrackCount > 1 && !selectedAudioTrack) {
			nativeWholeFile = audioTrackCount <= 32;
			for (let index = 0; nativeWholeFile && index < audioTrackCount; index++) {
				const candidate = await workloadReader.read(index);
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
		const identity = selectedAudioTrack ? { selectedAudioStreamIndex: selectedAudioTrack.streamIndex } : {};
		let declaredAudioSampleRate: number | null = selectedAudioTrack?.sampleRate ?? null;
		try {
			// Native decoders select different tracks across engines. Keep their path
			// only for shared timing; the container sink explicitly selects primary.
			if (!nativeWholeFile) throw new VideoAudioWholeFileLimitError();
			if (decodeFile.size > 32 * 1024 * 1024) throw new RangeError('Use bounded container audio decoding.');
			const encoded = await decodeFile.arrayBuffer();
			if (!selectedAudioTrack && audioTrackCount <= 1) declaredAudioSampleRate = options.inspectEncodedSampleRate(encoded);
			const decodedAudio = await decodeNativeVideoAudio(options, encoded);
			throwIfAborted(options.signal);
			assertDecodedVideoAudioWorkload(decodedAudio, budgetDurationSeconds, options.projectSampleRate, audioOffsetSeconds);
			return Object.freeze({
				decodedAudio: trimSelectedProgramme(placeImportedVideoAudio(decodedAudio, audioOffsetSeconds, durationSeconds), selectedEndSeconds),
				declaredAudioSampleRate, ...programme, ...identity,
			});
		} catch (error) {
			throwIfAborted(options.signal);
			if (workload && audioTrackCount <= 1 && error instanceof VideoAudioOutputLimitError) throw error;
			const forbidWholeFileFallback = workload !== null && audioTrackCount <= 1 && nativeWholeFile
				&& error instanceof VideoAudioWholeFileLimitError;
			try {
				const decodedAudio = await (options.decodeContainerAudio ?? decodeBrowserContainerAudio)(decodeFile, {
					signal: options.signal, durationSeconds,
					...(packetDecodePreferred ? { programmeSampleRate: options.projectSampleRate } : {}),
				});
				throwIfAborted(options.signal);
				assertDecodedVideoAudioWorkload(decodedAudio, budgetDurationSeconds, options.projectSampleRate);
				if ('programmeFrameCount' in decodedAudio && decodedAudio.programmeFrameCount !== undefined) {
					programme = { programmeFrameCount: scaleSampleFrame(
						decodedAudio.programmeFrameCount, decodedAudio.sampleRate, options.projectSampleRate, 'point',
					) };
				}
				return Object.freeze({
					decodedAudio: trimSelectedProgramme(decodedAudio, selectedEndSeconds),
					declaredAudioSampleRate, ...programme, ...identity,
				});
			} catch (error) {
				throwIfAborted(options.signal);
				if (workload && (error instanceof VideoAudioOutputLimitError || error instanceof VideoAudioWholeFileLimitError)) throw error;
				let firstWorkload = workload;
				if (audioTrackCount > 1 && !selectedAudioTrack) {
					// Both maintained FFmpeg routes explicitly map 0:a:0, independent of
					// container defaults. Its offset and source extent belong to that track.
					const first = await readVideoContainerAudioTiming(options.file, options.signal, 'first');
					audioOffsetSeconds = first.offsetSeconds;
					durationSeconds = Math.max(options.durationSeconds, first.programmeEndSeconds ?? 0);
					firstWorkload = await workloadReader.read('first');
					if (firstWorkload?.presentationEndSeconds != null) durationSeconds = Math.max(
						options.durationSeconds, Math.min(durationSeconds, firstWorkload.presentationEndSeconds),
					);
					programme = programmeFor(durationSeconds);
				}
				assertMinimumVideoAudioWindow(durationSeconds, options.projectSampleRate);
				if (forbidWholeFileFallback || !planVideoAudioWorkload(firstWorkload, durationSeconds,
					options.projectSampleRate, nativeRate).ffmpegWholeFile) throw new VideoAudioWholeFileLimitError();
				const decodedAudio = await options.decodeFfmpeg(decodeFile, {
					sampleRate: options.projectSampleRate, signal: options.signal,
				});
				throwIfAborted(options.signal);
				assertDecodedVideoAudioWorkload(decodedAudio, durationSeconds, options.projectSampleRate, audioOffsetSeconds);
				return Object.freeze({
					decodedAudio: trimSelectedProgramme(placeImportedVideoAudio(decodedAudio, audioOffsetSeconds, durationSeconds), selectedEndSeconds),
					declaredAudioSampleRate, ...programme, ...identity,
				});
			}
		}
	} finally { workloadReader.dispose(); }
}

function trimSelectedProgramme(decoded: ImportedVideoDecodedAudio, endSeconds: number | null): ImportedVideoDecodedAudio {
	if (endSeconds === null) return decoded;
	const end = secondsToSampleFrame(endSeconds, decoded.sampleRate, 'point');
	const channels = 'getChannelData' in decoded
		? Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index)) : decoded.channels;
	return { channels: channels.map(plane => plane.subarray(0, end)), sampleRate: decoded.sampleRate };
}

async function decodeNativeVideoAudio(
	{ decodeNative, signal }: ImportedVideoAudioDecodeOptions,
	encoded: ArrayBuffer,
): Promise<ImportedVideoDecodedAudio> {
	// Web Audio may never settle. Retire this attempt so the existing fallback can run.
	const deadline = new AbortController();
	const timer = setTimeout(() => { deadline.abort(); }, NATIVE_VIDEO_AUDIO_DECODE_TIMEOUT_MS);
	const scope = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
	try {
		return await raceAbortableRead(() => decodeNative(encoded), scope);
	} finally { clearTimeout(timer); }
}
