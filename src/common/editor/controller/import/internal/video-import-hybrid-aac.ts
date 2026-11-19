/* SPDX-License-Identifier: AGPL-3.0-only */

import type { InputAudioTrack } from 'mediabunny';
import { createIsoBoxReader } from '../../../iso-box-reader.ts';
import { explicitVideoAacLcGeometry, MAXIMUM_VIDEO_AUDIO_PCM_BYTES, type VideoAudioWorkload } from './video-import-audio-workload.ts';

const MAXIMUM_ENCODED_BYTES = 32 * 1024 * 1024;
const AAC_LC_PACKET_FRAMES = 1024;

/** Preserve the original AAC units when a nonempty ISO sample table masks its continuation. */
export async function projectHybridVideoAac(
	file: Blob, track: InputAudioTrack, signal?: AbortSignal,
): Promise<Readonly<{ file: Blob; workload: VideoAudioWorkload }> | null> {
	const { read, boxes, trackId, trackSampleTable, fragmentSampleView } = createIsoBoxReader(file, signal);
	const roots = await boxes(0, file.size);
	if (!roots.some(box => box.type === 'moof')) return null;
	const movies = roots.filter(box => box.type === 'moov');
	const movie = movies[0];
	if (!movie || movies.length !== 1) return null;
	const children = await boxes(movie.start, movie.end);
	if (!children.some(box => box.type === 'mvex')) return null;
	for (const trak of children.filter(box => box.type === 'trak')) {
		const fields = await boxes(trak.start, trak.end);
		const header = fields.find(box => box.type === 'tkhd');
		if (!header || await trackId(header) !== track.id) continue;
		// Only the single contiguous, unedited sample clock is projected here.
		if (fields.some(box => box.type === 'edts' || box.type === 'tref' || box.type === 'trgr')) return null;
		const tables = await trackSampleTable(trak);
		const descriptions = tables.find(box => box.type === 'stsd');
		const sizes = tables.find(box => box.type === 'stsz' || box.type === 'stz2');
		if (!descriptions || !sizes) return null;
		const stsd = await read(descriptions.start, 16, descriptions.end);
		if (stsd.getUint32(4) !== 1 || stsd.getUint32(12) !== 0x6d703461) return null; // mp4a
		const { initialCount, tail } = await fragmentSampleView(sizes);
		return tail ? muxHybridAac(track, initialCount, tail, signal) : null;
	}
	return null;
}

async function muxHybridAac(track: InputAudioTrack, initialCount: number, tail: Blob, signal?: AbortSignal) {
	const config = await track.getDecoderConfig();
	const geometry = explicitVideoAacLcGeometry(config);
	if (!config || !geometry) return null;
	const { sampleRate, channelCount } = geometry;
	const maximumPackets = Math.floor(MAXIMUM_VIDEO_AUDIO_PCM_BYTES / (channelCount * Float32Array.BYTES_PER_ELEMENT * AAC_LC_PACKET_FRAMES));
	if (initialCount >= maximumPackets) return null;
	const { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, Input, MP4, Mp4OutputFormat, Output, QTFF } = await import('mediabunny');
	signal?.throwIfAborted();
	const input = new Input({ source: new BlobSource(tail, { maxCacheSize: 1024 ** 2, useStreamReader: false }), formats: [MP4, QTFF] });
	const dispose = () => input.dispose();
	signal?.addEventListener('abort', dispose, { once: true });
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
	try {
		const fragments = (await input.getAudioTracks()).find(candidate => candidate.id === track.id);
		if (!fragments) return null;
		const source = new EncodedAudioPacketSource('aac');
		output.addAudioTrack(source);
		await output.start();
		let count = 0, endFrame = 0, encodedBytes = 0;
		for (const run of [track, fragments]) {
			for await (const packet of new EncodedPacketSink(run).packets()) {
				signal?.throwIfAborted();
				const timestamp = packet.timestamp * sampleRate;
				const duration = packet.duration * sampleRate;
				const frames = Math.round(duration);
				const startFrame = count * AAC_LC_PACKET_FRAMES;
				if (endFrame !== startFrame || Math.abs(timestamp - startFrame) > 1e-5
					|| frames < 1 || frames > AAC_LC_PACKET_FRAMES || Math.abs(duration - frames) > 1e-5) return null;
				endFrame = startFrame + frames;
				encodedBytes += packet.byteLength;
				count++;
				if (count > maximumPackets || encodedBytes > MAXIMUM_ENCODED_BYTES) return null;
				await source.add(packet, { decoderConfig: config });
			}
			if (run === track && count !== initialCount) return null;
		}
		if (count === initialCount) return null;
		await output.finalize();
		signal?.throwIfAborted();
		if (!target.buffer || target.buffer.byteLength > MAXIMUM_ENCODED_BYTES) return null;
		return {
			file: new Blob([target.buffer], { type: 'audio/mp4' }),
			workload: { ...geometry, codedFrameCount: count * AAC_LC_PACKET_FRAMES, presentationEndSeconds: endFrame / sampleRate },
		};
	} finally {
		signal?.removeEventListener('abort', dispose);
		input.dispose();
		if (output.state === 'started') await output.cancel();
	}
}
