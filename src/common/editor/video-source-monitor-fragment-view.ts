/* SPDX-License-Identifier: AGPL-3.0-only */

import { createIsoBoxReader } from './iso-box-reader.ts';
import { demuxIsobmffVideoTiming } from './video-timing-demux-isobmff.ts';
import { createVideoTimingDemuxReader } from './video-timing-demux-reader.ts';
export const MAXIMUM_FRAGMENT_PLAYBACK_VIEW_BYTES = 32 * 1024 * 1024;
const MAXIMUM_MUXER_TIMESCALE = 1_000_000;

export interface FragmentPlaybackClock {
	readonly timescale: number;
	readonly frameCount: number;
	readonly finalFrameDurationTicks: bigint;
	presentationTick(ordinal: number): bigint | undefined;
}

/** A local, picture-only playback view where browsers disagree on the original fragment clock. */
export async function prepareFragmentPlaybackView(
	file: Blob, timing: FragmentPlaybackClock, signal: AbortSignal,
	options: Readonly<{ maximumBytes?: number; standardSampleEntry?: boolean }> = {},
): Promise<Blob | null> {
	const maximumBytes = Math.min(options.maximumBytes ?? MAXIMUM_FRAGMENT_PLAYBACK_VIEW_BYTES, MAXIMUM_FRAGMENT_PLAYBACK_VIEW_BYTES);
	if (file.size > maximumBytes || timing.timescale > MAXIMUM_MUXER_TIMESCALE) return null;
	const { read, boxes, trackId, trackSampleTable, fragmentSampleView } = createIsoBoxReader(file, signal);
	const roots = await boxes(0, file.size);
	if (!roots.some(box => box.type === 'moof')) return null;
	const movies = roots.filter(box => box.type === 'moov');
	const movie = movies[0];
	if (!movie || movies.length !== 1) return null;
	const children = await boxes(movie.start, movie.end);
	if (!children.some(box => box.type === 'mvex')) return null;
	const {
		BlobSource, BufferTarget, EncodedPacketSink, EncodedVideoPacketSource, Input, MP4, Mp4OutputFormat, Output, QTFF,
	} = await import('mediabunny');
	signal.throwIfAborted();
	const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF] });
	let fragments: InstanceType<typeof Input> | null = null;
	let output: InstanceType<typeof Output> | null = null;
	const dispose = () => { input.dispose(); fragments?.dispose(); };
	signal.addEventListener('abort', dispose, { once: true });
	try {
		const tracks = await input.getVideoTracks();
		const track = tracks[0];
		if (!track || tracks.length !== 1 || await track.getCodec() !== 'avc') return null;
		let initialSampleCount: number | undefined;
		for (const trak of children.filter(box => box.type === 'trak')) {
			const fields = await boxes(trak.start, trak.end);
			const header = fields.find(box => box.type === 'tkhd');
			if (!header || await trackId(header) !== track.id) continue;
			const entries = await trackSampleTable(trak);
			const descriptions = entries.find(box => box.type === 'stsd');
			const sizes = entries.find(box => box.type === 'stsz' || box.type === 'stz2');
			if (!descriptions || !sizes) return null;
			const stsd = await read(descriptions.start, 16, descriptions.end);
			if (stsd.getUint32(4) !== 1 || stsd.getUint32(12) !== 0x61766331) return null; // avc1
			if (options.standardSampleEntry) {
				// Preserve configurations represented by the packet muxer. Keep the original
				// decoder path for extra presentation metadata such as clap or ICC profiles.
				const extensions = await boxes(descriptions.start + 16 + 78, descriptions.end);
				if (extensions.some(box => !['avcC', 'pasp', 'btrt'].includes(box.type))) return null;
			}
			const { initialCount, tail } = await fragmentSampleView(sizes);
			initialSampleCount = initialCount;
			if (tail) fragments = new Input({ source: new BlobSource(tail), formats: [MP4, QTFF] });
			break;
		}
		if (initialSampleCount === undefined) return null;
		const config = await track.getDecoderConfig();
		if (!config) return null;
		const fragmentTrack = fragments ? (await fragments.getVideoTracks()).find(candidate => candidate.id === track.id) : null;
		if (fragments && !fragmentTrack) return null;
		const origin = await track.getFirstTimestamp();
		const target = new BufferTarget();
		output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
		const source = new EncodedVideoPacketSource('avc');
		output.addVideoTrack(source, {
			frameRate: timing.timescale,
			transformationMatrix: await track.getTransformationMatrix(),
		});
		await output.start();
		let count = 0, bytes = 0;
		for (const leg of fragmentTrack ? [track, fragmentTrack] : [track]) {
			for await (const packet of new EncodedPacketSink(leg).packets()) {
				signal.throwIfAborted();
				bytes += packet.byteLength;
				if (++count > timing.frameCount || bytes > maximumBytes) return null;
				await source.add(packet.clone({ timestamp: packet.timestamp - origin }), { decoderConfig: config });
			}
			if (fragmentTrack && leg === track && count !== initialSampleCount) return null;
		}
		if (count !== timing.frameCount) return null;
		await output.finalize();
		if (!target.buffer || target.buffer.byteLength > maximumBytes) return null;
		const view = new Blob([target.buffer], { type: 'video/mp4' });
		const index = await demuxIsobmffVideoTiming(createVideoTimingDemuxReader(view, { signal }), { signal });
		if (!index || index.timescale !== timing.timescale || index.finalFrameDurationTicks !== timing.finalFrameDurationTicks
			|| index.presentationTicks.length !== timing.frameCount
			|| index.presentationTicks.some((tick, ordinal) => tick !== timing.presentationTick(ordinal))) return null;
		return view;
	} finally {
		signal.removeEventListener('abort', dispose);
		dispose();
		if (output?.state === 'started') await output.cancel();
	}
}
