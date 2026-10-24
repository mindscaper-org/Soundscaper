/* SPDX-License-Identifier: AGPL-3.0-only */
import { throwIfAborted } from '../../../video-timing-demux-reader.ts';
import { secondsToSampleFrame } from '../../../timeline-time.ts';
import type { ImportedVideoDecodedAudio } from './video-import-audio-decode.ts';

const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;

interface VideoContainerAudioTiming {
	readonly offsetSeconds: number;
	/** Authenticated ISO AAC-LC presentation end, relative to picture zero. */
	readonly programmeEndSeconds: number | null;
}

/** Whole-file decoders return PCM at zero; retain the primary picture-relative start. */
export async function readVideoContainerAudioOffset(blob: Blob, signal?: AbortSignal): Promise<number> {
	return (await inspectVideoContainerAudioTiming(blob, signal, false)).offsetSeconds;
}

/** Inspect programme end only where the container declares the decoded AAC extent. */
export async function readVideoContainerAudioTiming(blob: Blob, signal?: AbortSignal): Promise<VideoContainerAudioTiming> {
	return inspectVideoContainerAudioTiming(blob, signal, true);
}

async function inspectVideoContainerAudioTiming(blob: Blob, signal: AbortSignal | undefined,
	includeProgrammeEnd: boolean): Promise<VideoContainerAudioTiming> {
	throwIfAborted(signal);
	const { BlobSource, Input, MATROSKA, MP4, QTFF, WEBM } = await import('mediabunny');
	throwIfAborted(signal);
	const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, MATROSKA, WEBM] });
	const onAbort = (): void => input.dispose();
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
		const [audio, video] = await Promise.all([input.getPrimaryAudioTrack(), input.getPrimaryVideoTrack()]);
		if (!audio || !video) return { offsetSeconds: 0, programmeEndSeconds: null };
		const [audioStart, videoStart] = await Promise.all([audio.getFirstTimestamp(), video.getFirstTimestamp()]);
		throwIfAborted(signal);
		if (!Number.isFinite(audioStart) || !Number.isFinite(videoStart)) throw new RangeError('Invalid container audio timing.');
		// Native whole-file decoders already remove samples before composition zero
		// (for example negative AAC priming); those must not be removed twice.
		const offsetSeconds = Math.max(0, audioStart) - Math.max(0, videoStart);
		let programmeEndSeconds: number | null = null;
		if (includeProgrammeEnd) {
			try {
				const format = await input.getFormat();
				// Matroska's last-packet timestamp can exclude packet duration or
				// include codec padding, so it cannot establish this source extent.
				if ((format === MP4 || format === QTFF) && await audio.getCodec() === 'aac'
					&& await audio.getCodecParameterString() === 'mp4a.40.2') {
					const end = await audio.computeDuration();
					if (Number.isFinite(end) && end >= audioStart) programmeEndSeconds = Math.max(0, end - Math.max(0, videoStart));
				}
			} catch { throwIfAborted(signal); }
		}
		throwIfAborted(signal);
		return { offsetSeconds, programmeEndSeconds };
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
