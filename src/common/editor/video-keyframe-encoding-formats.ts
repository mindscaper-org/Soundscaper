/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoKeyframeEncoderFormat, VideoKeyframeVideoEncoderTier } from './video-keyframe-encoder-admission.ts';
import type { VideoDeliveryFfmpegQuality } from './video-delivery-quality.ts';

interface VideoEncodingDescriptor {
	readonly extension: '.mp4' | '.webm' | '.mov';
	readonly mimeType: 'video/mp4' | 'video/webm' | 'video/quicktime';
	readonly audioFrameSamples: 960 | 1_024;
	/** How a pre-encoded stream for this container has to be framed. */
	readonly elementaryFormat: 'h264' | 'ivf';
	arguments(
		frameRate: string,
		audioPadSamples: number | null,
		quality: VideoDeliveryFfmpegQuality,
		videoEncoder: VideoKeyframeVideoEncoderTier,
	): readonly string[];
}

/**
 * The video half of the command, which is the only part a tier decides.
 *
 * Everything else — mapping, metadata stripping, the audio encoder, the
 * container — is written once per format below and shared, so a WebCodecs
 * delivery and an FFmpeg delivery of the same plan differ in how the picture
 * was compressed and in nothing else. Audio in particular must not diverge:
 * it is the same staged mix at the same tier-derived bit rate either way.
 */
function videoArguments(
	videoEncoder: VideoKeyframeVideoEncoderTier,
	frameRate: string,
	encoded: readonly string[],
): readonly string[] {
	// The chunks arrive already compressed, and the input rate was declared
	// where the elementary stream was opened; a copy may state neither again.
	return videoEncoder === 'webcodecs'
		? ['-c:v', 'copy']
		: [...encoded, '-pix_fmt', 'yuv420p', '-r', frameRate];
}

function h264Descriptor(format: 'mp4' | 'mov'): VideoEncodingDescriptor {
	return Object.freeze({
		extension: format === 'mp4' ? '.mp4' : '.mov',
		mimeType: format === 'mp4' ? 'video/mp4' : 'video/quicktime',
		audioFrameSamples: 1_024 as const,
		elementaryFormat: 'h264' as const,
		arguments: (
			frameRate: string, audioPadSamples: number | null, quality: VideoDeliveryFfmpegQuality,
			videoEncoder: VideoKeyframeVideoEncoderTier,
		) => Object.freeze([
			...(audioPadSamples === null ? [] : ['-filter:a', `apad=whole_len=${String(audioPadSamples)}`]),
			'-map', '0:v:0', ...(audioPadSamples === null ? [] : ['-map', '1:a:0']),
			'-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn',
			...videoArguments(videoEncoder, frameRate, [
				'-c:v', 'libx264', '-preset', String(quality.preset), '-crf', String(quality.crf),
			]),
			...(audioPadSamples === null
				? ['-an']
				: ['-c:a', 'aac', '-b:a', `${String(quality.audioBitRateKbps)}k`]),
			'-movflags', '+faststart', '-f', format,
		]),
	});
}

export const VIDEO_ENCODING_DESCRIPTORS: Readonly<Record<VideoKeyframeEncoderFormat, VideoEncodingDescriptor>> =
	Object.freeze({
		mp4: h264Descriptor('mp4'),
		mov: h264Descriptor('mov'),
		webm: Object.freeze({
			extension: '.webm' as const,
			mimeType: 'video/webm' as const,
			audioFrameSamples: 960 as const,
			elementaryFormat: 'ivf' as const,
			arguments: (
				frameRate: string, audioPadSamples: number | null, quality: VideoDeliveryFfmpegQuality,
				videoEncoder: VideoKeyframeVideoEncoderTier,
			) => Object.freeze([
				...(audioPadSamples === null ? [] : ['-filter:a', `apad=whole_len=${String(audioPadSamples)}`]),
				'-map', '0:v:0', ...(audioPadSamples === null ? [] : ['-map', '1:a:0']),
				'-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn',
				...videoArguments(videoEncoder, frameRate, [
					'-c:v', 'libvpx-vp9', '-crf', String(quality.crf), '-b:v', '0',
					'-deadline', String(quality.deadline), '-cpu-used', String(quality.cpuUsed),
				]),
				...(audioPadSamples === null
					? ['-an']
					: ['-c:a', 'libopus', '-b:a', `${String(quality.audioBitRateKbps)}k`]),
				'-f', 'webm',
			]),
		}),
	});
