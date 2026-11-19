/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortableRead } from '../foundation/abort-race.ts';
import { BROWSER_OPUS_WEB_CODECS_SAMPLE_RATE as VIDEO_OPUS_SAMPLE_RATE, browserWebCodecsAudioConfiguration } from './browser-webcodecs-audio-profile.ts';
import { createStreamingWindowedSincResampler } from './resample.js';
import type { VideoMediabunnyPcmChunk } from './video-mediabunny-muxer.ts';

export const VIDEO_OPUS_PACKET_FRAMES = 960;
const INPUT_BLOCK_FRAMES = 4_096;
const SAMPLE_BYTES = Float32Array.BYTES_PER_ELEMENT;

/** Test the selected encoder's flush at one full packet. Some encoders need explicit lookahead. */
export async function probeVideoOpusTail(
	channelCount: number, bitrate: number, signal?: AbortSignal,
): Promise<number | null> {
	if (typeof AudioEncoder !== 'function' || typeof AudioData !== 'function') return null;
	signal?.throwIfAborted();
	let preSkip: number | null = null, packets = 0, packetTimingKnown = true;
	let reportFailure!: (error: unknown) => void;
	const failure = new Promise<never>((_resolve, reject) => { reportFailure = reject; });
	void failure.catch(() => undefined);
	const encoder = new AudioEncoder({
		error: reportFailure,
		output(chunk, metadata) {
			packets++;
			packetTimingKnown &&= chunk.duration === 20_000;
			const description = metadata?.decoderConfig?.description;
			if (description) {
				const header = ArrayBuffer.isView(description)
					? new DataView(description.buffer, description.byteOffset, description.byteLength) : new DataView(description);
				if (header.byteLength >= 19 && header.getUint32(0) === 0x4f707573 && header.getUint32(4) === 0x48656164) {
					preSkip = header.getUint16(10, true);
				}
			}
		},
	});
	try {
		const config = browserWebCodecsAudioConfiguration('opus', { sampleRate: VIDEO_OPUS_SAMPLE_RATE, channelCount, bitrate });
		encoder.configure(config);
		const data = new Float32Array(VIDEO_OPUS_PACKET_FRAMES * channelCount);
		for (let frame = 0; frame < VIDEO_OPUS_PACKET_FRAMES; frame++) {
			const value = Math.sin(frame / 16) * .125;
			data.fill(value, frame * channelCount, (frame + 1) * channelCount);
		}
		const sample = new AudioData({ format: 'f32', sampleRate: VIDEO_OPUS_SAMPLE_RATE, numberOfChannels: channelCount,
			numberOfFrames: VIDEO_OPUS_PACKET_FRAMES, timestamp: 0, data });
		try { encoder.encode(sample); } finally { sample.close(); }
		await raceAbortableRead(() => Promise.race([encoder.flush(), failure]), signal);
		return packetTimingKnown && preSkip !== null && packets * VIDEO_OPUS_PACKET_FRAMES - preSkip < VIDEO_OPUS_PACKET_FRAMES
			? preSkip : null;
	} finally { if (encoder.state !== 'closed') encoder.close(); }
}

export function videoOpusInputExtent(frames: number, preSkip: number | null): number {
	if (preSkip === null) return frames;
	const padded = Math.ceil((frames + preSkip) / VIDEO_OPUS_PACKET_FRAMES) * VIDEO_OPUS_PACKET_FRAMES;
	if (!Number.isSafeInteger(padded)) throw new RangeError('The Opus padded audio extent is too large.');
	return padded;
}

/** Stream PCM through the canonical resampler and preserve exact 20 ms encoder packetization. */
export async function writeResampledVideoOpus(options: Readonly<{
	inputSampleRate: number;
	channelCount: number;
	sourceFrames: number;
	resampledFrames: number;
	encodeFrames: number;
	read(offset: number, frames: number): Promise<Uint8Array<ArrayBuffer>>;
	write(chunk: VideoMediabunnyPcmChunk): Promise<void>;
}>): Promise<void> {
	const { inputSampleRate, channelCount, sourceFrames, resampledFrames, encodeFrames, read, write } = options;
	const frameBytes = channelCount * SAMPLE_BYTES;
	const resampler = createStreamingWindowedSincResampler(inputSampleRate, VIDEO_OPUS_SAMPLE_RATE, channelCount) as unknown as {
		push(channels: readonly Float32Array[]): readonly Float32Array[];
		finish(frames: number): readonly Float32Array[];
	};
	let packet = new Uint8Array(VIDEO_OPUS_PACKET_FRAMES * frameBytes);
	let fill = 0, sent = 0, converted = 0;
	const submit = async (frames: number): Promise<void> => {
		await write({ data: packet.subarray(0, frames * frameBytes), frameCount: frames, timestamp: sent / VIDEO_OPUS_SAMPLE_RATE });
		sent += frames;
		packet = new Uint8Array(VIDEO_OPUS_PACKET_FRAMES * frameBytes);
		fill = 0;
	};
	const spool = async (values: readonly Float32Array[]): Promise<void> => {
		const frames = values[0]?.length ?? 0;
		for (let offset = 0; offset < frames;) {
			const count = Math.min(frames - offset, VIDEO_OPUS_PACKET_FRAMES - fill);
			const dest = new DataView(packet.buffer);
			for (let frame = 0; frame < count; frame++) {
				for (let channel = 0; channel < channelCount; channel++) {
					dest.setFloat32((fill + frame) * frameBytes + channel * SAMPLE_BYTES, values[channel]![offset + frame]!, true);
				}
			}
			offset += count;
			fill += count;
			if (fill === VIDEO_OPUS_PACKET_FRAMES) await submit(fill);
		}
		converted += frames;
	};
	for (let offset = 0; offset < sourceFrames;) {
		const frames = Math.min(INPUT_BLOCK_FRAMES, sourceFrames - offset);
		const block = await read(offset, frames);
		const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
		const channels = Array.from({ length: channelCount }, (_, channel) => {
			const plane = new Float32Array(frames);
			for (let frame = 0; frame < frames; frame++) plane[frame] = view.getFloat32(frame * frameBytes + channel * SAMPLE_BYTES, true);
			return plane;
		});
		await spool(resampler.push(channels));
		offset += frames;
	}
	await spool(resampler.finish(resampledFrames));
	if (converted !== resampledFrames) throw new Error('The Opus audio resample did not reach its authored extent.');
	while (sent < encodeFrames) await submit(Math.min(VIDEO_OPUS_PACKET_FRAMES, encodeFrames - sent));
}
