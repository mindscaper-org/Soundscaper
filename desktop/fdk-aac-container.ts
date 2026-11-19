/* SPDX-License-Identifier: AGPL-3.0-only */
import { open } from 'node:fs/promises';
import {
	ADTS, MP4, QTFF, BufferSource, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink,
	FilePathSource, Input, Mp4OutputFormat, Output, StreamTarget,
} from 'mediabunny';
import { hasAdtsAudioSync } from './desktop-audio-decode-formats.ts';
import { exactAudioSpecificConfig } from './os-audio-codec-source-inspection.ts';

import { AAC_PACKET_FRAMES, AAC_RATES, supportsFdkAacGeometry } from './fdk-aac-geometry.ts';

type Geometry = Readonly<{ sampleRate: number; channelCount: number }>;
type DecodePlan = Geometry & Readonly<{ leadingFrames: number; decodedFrames: number; frameCount: number }>;
const MAXIMUM_TRIMMED_PREROLL = 8 * AAC_PACKET_FRAMES;

/** Demux only a single contiguous AAC-LC track. FDK independently rejects in-band SBR. */
export async function writeFdkAdts(inputBytes: Uint8Array, adtsPath: string, maximumPcmBytes: number,
	signal?: AbortSignal): Promise<DecodePlan | null> {
	const input = new Input({ formats: [MP4, QTFF, ADTS], source: new BufferSource(inputBytes) });
	const file = await open(adtsPath, 'wx', 0o600);
	try {
		const tracks = await input.getAudioTracks();
		const track = tracks.length === 1 ? tracks[0] : null;
		if (!track || await track.getCodec() !== 'aac') return null;
		const config = await track.getDecoderConfig();
		if (!config || config.codec !== 'mp4a.40.2'
			|| !supportsFdkAacGeometry(config.sampleRate, config.numberOfChannels)) return null;
		const sampleRate = config.sampleRate, channelCount = config.numberOfChannels;
		const adts = await input.getFormat() === ADTS;
		if (adts) {
			const rawChannels = (inputBytes[2]! & 1) << 2 | inputBytes[3]! >> 6;
			if (!hasAdtsAudioSync(inputBytes) || rawChannels !== channelCount) return null;
		} else {
			const data = config.description;
			if (!data) return null;
			const description = ArrayBuffer.isView(data)
				? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
			if (!exactAudioSpecificConfig(description, sampleRate, channelCount)) return null;
		}
		const frequency = AAC_RATES.findIndex(rate => rate === sampleRate);
		let decodedFrames = 0, endFrame = 0, firstFrame = 0;
		for await (const packet of new EncodedPacketSink(track).packets()) {
			signal?.throwIfAborted();
			const timestamp = packet.timestamp * sampleRate;
			const start = Math.round(timestamp);
			const duration = Math.round(packet.duration * sampleRate);
			if (decodedFrames === 0) firstFrame = start;
			if (!Number.isSafeInteger(start) || Math.abs(timestamp - start) > 0.01
				|| start !== firstFrame + decodedFrames || (decodedFrames !== 0 && start !== endFrame)
				|| duration < 1 || duration > AAC_PACKET_FRAMES
				|| packet.byteLength < 1 || packet.byteLength > (adts ? 8191 : 8184)) return null;
			decodedFrames += AAC_PACKET_FRAMES;
			endFrame = start + duration;
			// The final PCM budget is for presented samples. Allow bounded
			// preroll and a partial last AAC packet in scratch.
			if (decodedFrames - MAXIMUM_TRIMMED_PREROLL - AAC_PACKET_FRAMES > maximumPcmBytes / (channelCount * 4)) return null;
			if (adts) {
				await file.writeFile(packet.data, { signal });
				continue;
			}
			const size = packet.byteLength + 7;
			const header = Uint8Array.of(0xff, 0xf1, 0x40 | frequency << 2 | channelCount >> 2,
				(channelCount & 3) << 6 | size >> 11, size >> 3, (size & 7) << 5 | 0x1f, 0xfc);
			const data = new Uint8Array(size);
			data.set(header);
			data.set(packet.data, 7);
			await file.writeFile(data, { signal });
		}
		const leadingFrames = Math.max(0, -firstFrame);
		const frameCount = endFrame - Math.max(0, firstFrame);
		if (leadingFrames > MAXIMUM_TRIMMED_PREROLL || frameCount < 1 || frameCount * channelCount * 4 > maximumPcmBytes) return null;
		return { sampleRate, channelCount, leadingFrames, decodedFrames, frameCount };
	} catch (error) {
		signal?.throwIfAborted();
		// A demuxer refusal is an open-format fallback. A scratch I/O error is terminal.
		if (error instanceof Error && 'code' in error) throw error;
		return null;
	} finally {
		input.dispose();
		await file.close();
	}
}

/** Write AAC priming as an MP4 edit, and remove trailing padding from the presentation duration. */
export async function muxFdkAac(adtsPath: string, outputPath: string, geometry: Geometry,
	frameCount: number, delay: number, maximumBytes: number, signal?: AbortSignal): Promise<void> {
	const { sampleRate, channelCount } = geometry;
	const input = new Input({ formats: [ADTS], source: new FilePathSource(adtsPath, { maxCacheSize: 256 * 1024 }) });
	const file = await open(outputPath, 'wx', 0o600);
	const writable = new WritableStream<import('mediabunny').StreamTargetChunk>({
		async write({ data, position }) {
			signal?.throwIfAborted();
			if (position + data.byteLength > maximumBytes) throw new RangeError('The AAC/M4A output exceeds its byte bound.');
			const wrote = await file.write(data, 0, data.byteLength, position);
			if (wrote.bytesWritten !== data.byteLength) throw new Error('The M4A scratch write was incomplete.');
		},
	});
	const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable) });
	const source = new EncodedAudioPacketSource('aac');
	output.addAudioTrack(source);
	try {
		const track = await input.getPrimaryAudioTrack();
		const config = await track?.getDecoderConfig();
		if (!track || !config || config.codec !== 'mp4a.40.2' || config.sampleRate !== sampleRate
			|| config.numberOfChannels !== channelCount) throw new Error('The FDK AAC output geometry changed.');
		await output.start();
		let encodedFrames = 0;
		for await (const packet of new EncodedPacketSink(track).packets()) {
			signal?.throwIfAborted();
			const frame = encodedFrames - delay;
			if (frame >= frameCount || Math.round(packet.duration * sampleRate) !== AAC_PACKET_FRAMES) {
				throw new Error('The FDK AAC output has unexpected packets.');
			}
			const duration = Math.min(AAC_PACKET_FRAMES, frameCount - frame);
			await source.add(new EncodedPacket(packet.data, 'key', frame / sampleRate, duration / sampleRate),
				encodedFrames === 0 ? { decoderConfig: config } : undefined);
			encodedFrames += AAC_PACKET_FRAMES;
		}
		if (encodedFrames !== Math.ceil((delay + frameCount) / AAC_PACKET_FRAMES) * AAC_PACKET_FRAMES) {
			throw new Error('The FDK AAC output does not cover the PCM source.');
		}
		await output.finalize();
	} catch (error) {
		if (output.state !== 'finalized') await output.cancel();
		throw error;
	} finally {
		input.dispose();
		await file.close();
	}
}
