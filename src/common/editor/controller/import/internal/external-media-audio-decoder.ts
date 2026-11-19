/* SPDX-License-Identifier: AGPL-3.0-only */

import { openExternalMediaPcm } from '../../../external-media-pcm-reader.ts';
import { externalMediaForSource } from '../../../desktop-external-media.ts';
import { decodeBrowserContainerAudio } from '../../../browser-container-audio-decode.ts';
import { createStreamingWindowedSincResampler } from '../../../resample.js';
import { downmixSurroundToStereo } from '../../../surround-monitoring.ts';
import { scaleSampleFrame } from '../../../timeline-time.ts';
import type { ExternalAudioDecoder } from '../../../scape-external-media.ts';
import { decodeImportedVideoAudio, type ImportedVideoDecodedAudio } from './video-import-audio-decode.ts';

export interface ExternalAudioDecodePorts {
	decodeNative(encoded: ArrayBuffer, sampleRate: number | null): Promise<ImportedVideoDecodedAudio>;
	decodeCodec(file: Blob, settings: { sampleRate: number; signal?: AbortSignal }): Promise<ImportedVideoDecodedAudio>;
}

/** Rebuild the original import's PCM cache using its saved rate and sample shape. */
export function createExternalMediaAudioDecoder(ports: ExternalAudioDecodePorts): ExternalAudioDecoder {
	return async (file, source, signal, options) => {
		signal?.throwIfAborted();
		const frames = Number(source.frameCount), sampleRate = Number(source.sampleRate);
		const channels = Array.from({ length: Number(source.channelCount) }, () => new Float32Array(frames));
		const pcm = await openExternalMediaPcm(file, source, signal);
		if (pcm) {
			let offset = 0;
			await pcm.stream(async (packet) => {
				for (const [index, channel] of packet.entries()) channels[index]!.set(channel, offset);
				offset += packet[0]!.length;
			});
			return channels;
		}
		let decoded: ImportedVideoDecodedAudio;
		const reference = externalMediaForSource(source);
		const videoAudio = reference?.role === 'video-audio';
		const programme = videoAudio ? readVideoAudioProgramme(source, frames) : null;
		if (videoAudio && (programme || options?.videoAudioTiming === 'import')) {
			const result = await decodeImportedVideoAudio({
				file, projectSampleRate: sampleRate, nativeContextSampleRate: reference.decodeSampleRate ?? sampleRate,
				durationSeconds: (programme?.pictureFrameCount ?? frames) / sampleRate, hasAudio: true, signal,
				audioProgramme: programme?.streamIndex ?? 'legacy',
				inspectEncodedSampleRate: () => null,
				decodeNative: (encoded, rate) => ports.decodeNative(encoded, rate ?? reference.decodeSampleRate ?? null),
				decodeFfmpeg: (input, settings) => ports.decodeCodec(input, settings),
			});
			decoded = result.decodedAudio;
		} else if (videoAudio) {
			try {
				if (file.size > 32 * 1024 * 1024) throw new RangeError('Use the container audio decoder.');
				decoded = await ports.decodeNative(await file.arrayBuffer(), reference.decodeSampleRate ?? null);
			} catch {
				try { decoded = await decodeBrowserContainerAudio(file, { signal, durationSeconds: frames / sampleRate }); }
				catch { signal?.throwIfAborted(); decoded = await ports.decodeCodec(file, { sampleRate, signal }); }
			}
		} else decoded = await ports.decodeCodec(file, { sampleRate, signal });
		signal?.throwIfAborted();
		let input = decoded.channels ?? Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
		if (input.length > 2 && channels.length === 2) input = downmix(input);
		if (videoAudio && decoded.sampleRate !== sampleRate) {
			const outputFrames = Math.max(1, scaleSampleFrame(input[0]!.length, decoded.sampleRate, sampleRate, 'point'));
			const resampler = createStreamingWindowedSincResampler(decoded.sampleRate, sampleRate, input.length) as {
				push(channels: Float32Array[]): Float32Array[]; finish(outputFrames?: number | null): Float32Array[];
			};
			const head = resampler.push([...input]), tail = resampler.finish(outputFrames);
			input = head.map((values, index) => {
				const output = new Float32Array(values.length + tail[index]!.length);
				output.set(values); output.set(tail[index]!, values.length);
				return output.length === outputFrames ? output : output.slice(0, outputFrames);
			});
		}
		if ((!videoAudio && decoded.sampleRate !== sampleRate) || input.length !== channels.length
			|| (!videoAudio && input.some((channel) => channel.length !== frames))) {
			throw new Error('External audio does not match its saved rate and channel shape.');
		}
		for (const [index, channel] of input.entries()) channels[index]!.set(channel.subarray(0, frames));
		return channels;
	};
}

function readVideoAudioProgramme(source: Readonly<Record<string, unknown>>, frames: number):
	Readonly<{ streamIndex: number; pictureFrameCount: number }> | null {
	const value = (source.opaqueExtensions as Readonly<Record<string, unknown>> | undefined)?.videoAudioProgramme;
	if (value === undefined) return null;
	const { streamIndex, pictureFrameCount } = (value ?? {}) as Readonly<Record<string, unknown>>;
	if (typeof streamIndex !== 'number' || !Number.isSafeInteger(streamIndex) || streamIndex < 0
		|| typeof pictureFrameCount !== 'number' || !Number.isSafeInteger(pictureFrameCount)
		|| pictureFrameCount < 1 || pictureFrameCount > frames) {
		throw new RangeError('The recorded external video audio programme is invalid.');
	}
	return { streamIndex, pictureFrameCount };
}

function downmix(input: readonly Float32Array[]): readonly Float32Array[] {
	if (input.length === 6) return downmixSurroundToStereo(input);
	const left = input[0]!.slice(), right = input[1]!.slice();
	for (let frame = 0; frame < left.length; frame += 1) {
		for (let index = 2; index < input.length; index += 1) {
			const sample = input[index]![frame]! * (Math.SQRT1_2 * 0.5);
			left[frame] = left[frame]! + sample; right[frame] = right[frame]! + sample;
		}
	}
	return [left, right];
}
