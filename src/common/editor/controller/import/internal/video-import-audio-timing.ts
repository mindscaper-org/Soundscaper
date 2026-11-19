/* SPDX-License-Identifier: AGPL-3.0-only */
import { throwIfAborted } from '../../../video-timing-demux-reader.ts';
import { isQuickTimeS16Pcm } from '../../../browser-container-audio-decode.ts';
import { secondsToSampleFrame } from '../../../timeline-time.ts';
import type { ImportedVideoDecodedAudio } from './video-import-audio-decode.ts';
import type { VideoAudioWorkload } from './video-import-audio-workload.ts';

const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;

interface VideoContainerAudioTiming {
	readonly offsetSeconds: number;
	readonly audioTrackCount: number;
	/** A native decoder may choose any programme only when all have these timings. */
	readonly nativeTimingShared: boolean;
	readonly packetDecodePreferred?: boolean;
	readonly selectedAudioTrack?: Readonly<{ file: Blob; ordinal: number; streamIndex: number; sampleRate: number }>;
	readonly hybridAacWorkload?: VideoAudioWorkload;
	/** Authenticated ISO AAC-LC presentation end, relative to picture zero. */
	readonly programmeEndSeconds: number | null;
}
type AudioTimingSelection = 'primary' | 'legacy-primary' | 'first';

/** Whole-file decoders return PCM at zero; retain the primary picture-relative start. */
export async function readVideoContainerAudioOffset(blob: Blob, signal?: AbortSignal): Promise<number> {
	return (await inspectVideoContainerAudioTiming(blob, signal, false)).offsetSeconds;
}

/** Inspect programme end only where the container declares the decoded AAC extent. */
export async function readVideoContainerAudioTiming(blob: Blob, signal?: AbortSignal,
	selection: AudioTimingSelection = 'primary'): Promise<VideoContainerAudioTiming> {
	return inspectVideoContainerAudioTiming(blob, signal, true, selection);
}

async function inspectVideoContainerAudioTiming(blob: Blob, signal: AbortSignal | undefined,
	includeProgrammeEnd: boolean, selection: AudioTimingSelection = 'legacy-primary'): Promise<VideoContainerAudioTiming> {
	throwIfAborted(signal);
	const { BlobSource, Input, MATROSKA, MP4, QTFF, WEBM } = await import('mediabunny');
	throwIfAborted(signal);
	const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, MATROSKA, WEBM] });
	const onAbort = (): void => input.dispose();
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
		// getAudioTracks preserves file order, matching FFmpeg's explicit 0:a:0.
		const [tracks, video] = await Promise.all([input.getAudioTracks(), input.getPrimaryVideoTrack()]);
		let audio = selection === 'first' ? tracks[0] : await input.getPrimaryAudioTrack();
		const audioTrackCount = tracks.length;
		if (!audio || !video) return { offsetSeconds: 0, programmeEndSeconds: null, audioTrackCount, nativeTimingShared: audioTrackCount <= 1 };
		const format = includeProgrammeEnd ? await input.getFormat() : null;
		let selectedAudioTrack: VideoContainerAudioTiming['selectedAudioTrack'];
		if (selection === 'primary' && (format === MP4 || format === QTFF) && audioTrackCount > 1 && audioTrackCount <= 32
			&& (await input.getVideoTracks()).length === 1) {
			const dispositions = await Promise.all(tracks.map(track => track.getDisposition()));
			const ordinal = dispositions.findIndex(disposition => disposition.default);
			const enabled = tracks[ordinal];
			const geometry = enabled && !dispositions.slice(ordinal + 1).some(disposition => disposition.default)
				? (await import('./video-import-audio-workload.ts')).explicitVideoAacLcGeometry(await enabled.getDecoderConfig()) : null;
			if (enabled && geometry) {
				const streamIndex = (await input.getTracks()).indexOf(enabled);
				const { isolateIsoAudioProgramme } = await import('../../../iso-audio-presentation-edit.ts');
				const file = await isolateIsoAudioProgramme(blob, enabled.id, tracks.filter(track => track !== enabled).map(track => track.id), signal);
				if (streamIndex >= 0 && file) {
					audio = enabled;
					selectedAudioTrack = { file, ordinal, streamIndex, sampleRate: geometry.sampleRate };
				}
			}
		}
		const [audioStart, videoStart] = await Promise.all([audio.getFirstTimestamp(), video.getFirstTimestamp()]);
		throwIfAborted(signal);
		if (!Number.isFinite(audioStart) || !Number.isFinite(videoStart)) throw new RangeError('Invalid container audio timing.');
		if (selection === 'primary' && (format === MP4 || format === QTFF) && audioTrackCount === 1
			&& audioStart === 0 && videoStart === 0) {
			try {
				const tracks = await input.getTracks();
				const streamIndex = tracks.indexOf(audio);
				if (streamIndex >= 0 && tracks.length === 2 && await audio.getCodec() === 'aac') {
					const { projectHybridVideoAac } = await import('./video-import-hybrid-aac.ts');
					const hybrid = await projectHybridVideoAac(blob, audio, signal);
					if (hybrid) return {
						offsetSeconds: 0, audioTrackCount, nativeTimingShared: true,
						selectedAudioTrack: { file: hybrid.file, ordinal: 0, streamIndex, sampleRate: hybrid.workload.sampleRate },
						hybridAacWorkload: hybrid.workload, programmeEndSeconds: hybrid.workload.presentationEndSeconds ?? null,
					};
				}
			} catch { throwIfAborted(signal); }
		}
		// Native whole-file decoders already remove samples before composition zero
		// (for example negative AAC priming); those must not be removed twice.
		const offsetSeconds = Math.max(0, audioStart) - Math.max(0, videoStart);
		let programmeEndSeconds: number | null = null;
		let preferTimestampedPcm = false;
		if (includeProgrammeEnd) {
			try {
				const codec = await audio.getCodec();
				// Matroska's last-packet timestamp can exclude packet duration or
				// include codec padding, so it cannot establish this source extent.
				if ((format === MP4 || format === QTFF) && codec === 'aac'
					&& await audio.getCodecParameterString() === 'mp4a.40.2') {
					const end = await audio.computeDuration();
					if (Number.isFinite(end) && end >= audioStart) programmeEndSeconds = Math.max(0, end - Math.max(0, videoStart));
				}
				preferTimestampedPcm = format === QTFF && isQuickTimeS16Pcm(codec) && audioTrackCount === 1
					&& (await input.getVideoTracks()).length === 1 && await audio.getNumberOfChannels() <= 2;
			} catch { throwIfAborted(signal); }
		}
		let nativeTimingShared = audioTrackCount <= 1;
		if (!selectedAudioTrack && !nativeTimingShared && programmeEndSeconds !== null) {
			try {
				nativeTimingShared = true;
				for (const other of tracks) {
					if (other.id === audio.id) continue;
					const start = await other.getFirstTimestamp();
					const shared = Number.isFinite(start)
						&& Math.max(0, start) - Math.max(0, videoStart) === offsetSeconds
						&& await other.getCodec() === 'aac' && await other.getCodecParameterString() === 'mp4a.40.2'
						&& Math.max(0, await other.computeDuration() - Math.max(0, videoStart)) === programmeEndSeconds;
					throwIfAborted(signal);
					if (!shared) { nativeTimingShared = false; break; }
				}
			} catch { throwIfAborted(signal); nativeTimingShared = false; }
		}
		throwIfAborted(signal);
		const config = await audio.getDecoderConfig();
		const packetDecodePreferred = preferTimestampedPcm || config !== null
			&& (await import('../../../browser-container-opus-decoder.ts')).hasReviewedContainerOpusPreSkip(config);
		throwIfAborted(signal);
		return { offsetSeconds, programmeEndSeconds, audioTrackCount, nativeTimingShared,
			...(packetDecodePreferred ? { packetDecodePreferred: true } : {}),
			...(selectedAudioTrack ? { selectedAudioTrack } : {}) };
	} finally {
		signal?.removeEventListener('abort', onAbort);
		input.dispose();
	}
}

/** Fit untimestamped PCM to the picture window, padding a leader or removing an earlier audio segment. */
export function placeImportedVideoAudio(
	decoded: ImportedVideoDecodedAudio,
	offsetSeconds: number,
	durationSeconds: number,
): ImportedVideoDecodedAudio {
	if (offsetSeconds === 0) return decoded;
	const sourceChannels = 'getChannelData' in decoded ? Array.from(
		{ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel),
	) : decoded.channels;
	if (!sourceChannels.length) return decoded;
	const frameCount = secondsToSampleFrame(durationSeconds, decoded.sampleRate, 'enclosingEnd');
	const offsetFrames = secondsToSampleFrame(offsetSeconds, decoded.sampleRate, 'point');
	if (!Number.isSafeInteger(frameCount) || frameCount < 1 || !Number.isSafeInteger(offsetFrames)
		|| frameCount * sourceChannels.length * Float32Array.BYTES_PER_ELEMENT > MAXIMUM_OUTPUT_BYTES) {
		throw new RangeError('The aligned video audio exceeds its output bound.');
	}
	const sourceOffset = Math.max(0, -offsetFrames);
	const targetOffset = Math.min(frameCount, Math.max(0, offsetFrames));
	return {
		sampleRate: decoded.sampleRate,
		channels: sourceChannels.map((source) => {
			const target = new Float32Array(frameCount);
			const count = Math.max(0, Math.min(source.length - sourceOffset, frameCount - targetOffset));
			target.set(source.subarray(sourceOffset, sourceOffset + count), targetOffset);
			return target;
		}),
	};
}
