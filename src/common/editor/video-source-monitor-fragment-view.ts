/* SPDX-License-Identifier: AGPL-3.0-only */

import { createIsoBoxReader, type IsoBox } from './iso-box-reader.ts';
import { demuxIsobmffVideoTiming, hasLeadingIsobmffVideoEdit } from './video-timing-demux-isobmff.ts';
import { createVideoTimingDemuxReader } from './video-timing-demux-reader.ts';
export const MAXIMUM_FRAGMENT_PLAYBACK_VIEW_BYTES = 32 * 1024 * 1024;
const MAXIMUM_MUXER_TIMESCALE = 1_000_000;
const AV1_CONFIGURATION_HEADER_BYTES = 4;
const MAXIMUM_AV1_CONFIGURATION_BYTES = 32;

export interface FragmentPlaybackClock {
	readonly timescale: number;
	readonly frameCount: number;
	readonly finalFrameDurationTicks: bigint;
	presentationTick(ordinal: number): bigint | undefined;
}

type FragmentPlaybackOptions = Readonly<{ maximumBytes?: number; standardSampleEntry?: boolean; programmePicture?: boolean }>;

export async function prepareFragmentPlaybackView(
	file: Blob, timing: FragmentPlaybackClock, signal: AbortSignal, options?: FragmentPlaybackOptions,
): Promise<Blob | null> {
	return (await prepareQualifiedFragmentPlaybackView(file, timing, signal, options))?.blob ?? null;
}

/** A local, picture-only playback view where browsers disagree on the original fragment clock. */
export async function prepareQualifiedFragmentPlaybackView(
	file: Blob, timing: FragmentPlaybackClock, signal: AbortSignal,
	options: FragmentPlaybackOptions = {},
): Promise<Readonly<{ blob: Blob; compositionShiftSeconds: number }> | null> {
	const maximumBytes = Math.min(options.maximumBytes ?? MAXIMUM_FRAGMENT_PLAYBACK_VIEW_BYTES, MAXIMUM_FRAGMENT_PLAYBACK_VIEW_BYTES);
	if (file.size > maximumBytes || timing.timescale > MAXIMUM_MUXER_TIMESCALE) return null;
	const reader = createIsoBoxReader(file, signal);
	const { boxes, trackId, trackSampleTable, fragmentSampleView, singleVisualSampleEntry } = reader;
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
		if (!track || tracks.length !== 1) return null;
		const codec = await track.getCodec();
		if (codec !== 'avc' && codec !== 'av1') return null;
		const restrictedProfile = options.programmePicture || codec === 'av1';
		if (restrictedProfile && await hasLeadingIsobmffVideoEdit(createVideoTimingDemuxReader(file, { signal }), signal)) return null;
		let initialSampleCount: number | undefined;
		let av1Configuration: Uint8Array | null = null;
		for (const trak of children.filter(box => box.type === 'trak')) {
			const fields = await boxes(trak.start, trak.end);
			const header = fields.find(box => box.type === 'tkhd');
			if (!header || await trackId(header) !== track.id) continue;
			const entries = await trackSampleTable(trak);
			const descriptions = entries.find(box => box.type === 'stsd');
			const sizes = entries.find(box => box.type === 'stsz' || box.type === 'stz2');
			if (!descriptions || !sizes) return null;
			const entryExtensions = await singleVisualSampleEntry(descriptions, codec === 'avc' ? 'avc1' : 'av01');
			if (entryExtensions === null) return null;
			if (codec === 'av1') {
				av1Configuration = await readAv1Configuration(reader, await boxes(entryExtensions, descriptions.end));
				if (!av1Configuration) return null;
			} else if (options.standardSampleEntry) {
				// Preserve configurations represented by the packet muxer. Keep the original
				// decoder path for extra presentation metadata such as clap or ICC profiles.
				const extensions = await boxes(entryExtensions, descriptions.end);
				if (extensions.some(box => !['avcC', 'pasp', 'btrt'].includes(box.type))) return null;
			}
			const { initialCount, tail } = await fragmentSampleView(sizes);
			if (options.programmePicture && initialCount === 0 && fields.some(box => box.type === 'edts')) return null;
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
		const transformationMatrix = await track.getTransformationMatrix();
		const videoOnlyFragment = options.programmePicture && codec === 'avc' && !fragmentTrack
			&& (await input.getTracks()).length === 1;
		if (restrictedProfile) {
			const ratio = await track.getPixelAspectRatio();
			if ((!videoOnlyFragment && (!fragmentTrack || origin !== 0)) || ratio.num !== ratio.den
				|| transformationMatrix.some((component, index) => component !== (index % 4 === 0 ? 1 : 0))) return null;
		}
		const target = new BufferTarget();
		output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
		const source = new EncodedVideoPacketSource(codec);
		output.addVideoTrack(source, {
			frameRate: timing.timescale,
			transformationMatrix,
		});
		await output.start();
		let count = 0, bytes = 0;
		let previousTimestamp = -Infinity;
		let reordered = false;
		const configObus = av1Configuration?.subarray(AV1_CONFIGURATION_HEADER_BYTES);
		for (const leg of fragmentTrack ? [track, fragmentTrack] : [track]) {
			let first = true;
			for await (const packet of new EncodedPacketSink(leg).packets()) {
				signal.throwIfAborted();
				// The muxer writes the AV1 config header without in-box OBUs. Every
				// independent access point must already carry those exact bytes.
				if (configObus && (first && packet.type !== 'key'
					|| packet.type === 'key' && !configObus.every((value, index) => packet.data[index] === value))) return null;
				first = false;
				bytes += packet.byteLength;
				if (++count > timing.frameCount || bytes > maximumBytes) return null;
				if (videoOnlyFragment && !reordered) {
					reordered = packet.timestamp < previousTimestamp;
					previousTimestamp = packet.timestamp;
				}
				await source.add(packet.clone({ timestamp: packet.timestamp - origin }), { decoderConfig: config });
			}
			if (fragmentTrack && leg === track && count !== initialSampleCount) return null;
		}
		// Browsers may shift a fully fragmented reordered picture clock. Apply
		// this Programme view only if the source actually reorders its pictures.
		if (count !== timing.frameCount || (videoOnlyFragment && !reordered)) return null;
		await output.finalize();
		if (!target.buffer || target.buffer.byteLength > maximumBytes) return null;
		const view = new Blob([target.buffer], { type: 'video/mp4' });
		if (av1Configuration && !await matchesProjectedAv1Header(view, av1Configuration, signal)) return null;
		const index = await demuxIsobmffVideoTiming(createVideoTimingDemuxReader(view, { signal }),
			{ signal, includeCompositionShift: options.programmePicture === true });
		if (!index || index.timescale !== timing.timescale || index.finalFrameDurationTicks !== timing.finalFrameDurationTicks
			|| index.presentationTicks.length !== timing.frameCount
			|| index.presentationTicks.some((tick, ordinal) => tick !== timing.presentationTick(ordinal))) return null;
		return Object.freeze({ blob: view, compositionShiftSeconds: Number(index.compositionShiftTicks ?? 0n) / index.timescale });
	} finally {
		signal.removeEventListener('abort', dispose);
		dispose();
		if (output?.state === 'started') await output.cancel();
	}
}

async function readAv1Configuration(
	reader: ReturnType<typeof createIsoBoxReader>, extensions: readonly IsoBox[],
): Promise<Uint8Array | null> {
	if (extensions.some(box => !['av1C', 'fiel', 'btrt'].includes(box.type))
		|| new Set(extensions.map(box => box.type)).size !== extensions.length) return null;
	const fields = extensions.find(box => box.type === 'fiel');
	if (fields && (fields.end - fields.start !== 2 || (await reader.read(fields.start, 2, fields.end)).getUint16(0) !== 0x0100)) return null;
	const configuration = extensions.find(box => box.type === 'av1C');
	if (!configuration) return null;
	const length = configuration.end - configuration.start;
	if (length < AV1_CONFIGURATION_HEADER_BYTES || length > MAXIMUM_AV1_CONFIGURATION_BYTES) return null;
	return new Uint8Array((await reader.read(configuration.start, length, configuration.end)).buffer);
}

async function matchesProjectedAv1Header(view: Blob, expected: Uint8Array, signal: AbortSignal): Promise<boolean> {
	const { boxes, trackSampleTable, singleVisualSampleEntry, read } = createIsoBoxReader(view, signal);
	const movie = (await boxes(0, view.size)).find(box => box.type === 'moov');
	const track = movie && (await boxes(movie.start, movie.end)).find(box => box.type === 'trak');
	const descriptions = track && (await trackSampleTable(track)).find(box => box.type === 'stsd');
	if (!descriptions) return false;
	const start = await singleVisualSampleEntry(descriptions, 'av01');
	if (start === null) return false;
	const configuration = (await boxes(start, descriptions.end)).find(box => box.type === 'av1C');
	if (!configuration || configuration.end - configuration.start !== AV1_CONFIGURATION_HEADER_BYTES) return false;
	const generated = await read(configuration.start, AV1_CONFIGURATION_HEADER_BYTES, configuration.end);
	return expected.subarray(0, AV1_CONFIGURATION_HEADER_BYTES).every((value, index) => generated.getUint8(index) === value);
}
