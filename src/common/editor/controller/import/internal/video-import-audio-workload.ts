/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../../../abort-race.ts';
import { secondsToSampleFrame } from '../../../timeline-time.ts';
import { readIsoAudioPresentationEnd } from '../../../iso-audio-presentation-edit.ts';
import type { ImportedVideoDecodedAudio } from './video-import-audio-decode.ts';

const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;
const MAXIMUM_MOVIE_BYTES = 1024 ** 2;
const MAXIMUM_HEADERS = 8192;
interface Box { readonly type: string; readonly body: number; readonly end: number }
export interface VideoAudioWorkload {
	readonly sampleRate: number;
	readonly channelCount: number;
	/** All coded access units, including media outside a presentation edit. */
	readonly codedFrameCount: number;
	/** A declared edit end, relative to the sole picture track; never inferred from AU count. */
	readonly presentationEndSeconds?: number | null;
}
export class VideoAudioOutputLimitError extends RangeError {
	constructor() { super('The extracted video audio exceeds its output bound.'); }
}
export class VideoAudioWholeFileLimitError extends RangeError {
	constructor() { super('Whole-file video audio decoding exceeds its output bound.'); }
}

/** Only explicit, fixed AAC-LC reconstruction can establish a pre-decode workload. */
export function explicitVideoAacLcGeometry(config: AudioDecoderConfig | null): Readonly<{ sampleRate: number; channelCount: number }> | null {
	if (config?.codec !== 'mp4a.40.2' || !config.description || config.description.byteLength < 5 || config.description.byteLength > 64) return null;
	const bytes = ArrayBuffer.isView(config.description)
		? new Uint8Array(config.description.buffer, config.description.byteOffset, config.description.byteLength) : new Uint8Array(config.description);
	let position = 0;
	const read = (count: number): number => {
		if (position + count > bytes.length * 8) return -1;
		let value = 0;
		while (count--) value = value * 2 + ((bytes[position >> 3]! >> (7 - (position++ & 7))) & 1);
		return value;
	};
	if (read(5) !== 2) return null;
	const rate = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350][read(4)];
	const channels = read(4);
	// The three GA flags select 1024-frame, independent, ordinary AAC-LC units.
	if (!rate || ![1, 2].includes(channels) || read(3) !== 0 || rate !== config.sampleRate || channels !== config.numberOfChannels) return null;
	// Explicit SBR absence also excludes implicit parametric-stereo reconstruction.
	if (read(11) !== 0x2b7 || read(5) !== 5 || read(1) !== 0) return null;
	while (position < bytes.length * 8) if (read(1) !== 0) return null;
	return { sampleRate: rate, channelCount: channels };
}

/** Bound metadata inspection for the programme selected by each decoder. */
export async function readVideoAudioWorkload(file: Blob, signal?: AbortSignal,
	selection: 'primary' | 'first' | number = 'primary'): Promise<VideoAudioWorkload | null> {
	try {
		const movie = await readMovie(file, signal);
		if (!movie) return null;
		const { BlobSource, Input, MP4, QTFF } = await raceAbortableRead(() => import('mediabunny'), signal);
		signal?.throwIfAborted();
		const input = new Input({ source: new BlobSource(file, { maxCacheSize: MAXIMUM_MOVIE_BYTES, useStreamReader: false }), formats: [MP4, QTFF] });
		const onAbort = (): void => input.dispose(); signal?.addEventListener('abort', onAbort, { once: true });
		try {
			const [tracks, pictures] = await raceAbortableRead(() => Promise.all([input.getAudioTracks(), input.getVideoTracks()]), signal);
			if (!tracks.length || tracks.length > 32 || pictures.length !== 1) return null;
			const track = typeof selection === 'number' ? tracks[selection] : selection === 'first'
				? tracks[0] : await raceAbortableRead(() => input.getPrimaryAudioTrack(), signal);
			if (!track) return null;
			const config = await raceAbortableRead(() => track.getDecoderConfig(), signal);
			const geometry = explicitVideoAacLcGeometry(config);
			if (!geometry) return null;
			const [rate, channels] = await raceAbortableRead(() => Promise.all([track.getSampleRate(), track.getNumberOfChannels()]), signal);
			if (rate !== geometry.sampleRate || channels !== geometry.channelCount) return null;
			const packets = codedAacPacketCount(movie, track.id, geometry.sampleRate, file.size);
			if (packets === null) return null;
			const [editEnd, pictureStart] = await raceAbortableRead(() => Promise.all([
				readIsoAudioPresentationEnd(file, track.id, signal), pictures[0]!.getFirstTimestamp(),
			]), signal);
			signal?.throwIfAborted();
			if (!Number.isFinite(pictureStart)) return null;
			return { ...geometry, codedFrameCount: packets * 1024,
				presentationEndSeconds: editEnd === null ? null : Math.max(0, editEnd - Math.max(0, pictureStart)) };
		} finally { signal?.removeEventListener('abort', onAbort); input.dispose(); }
	} catch { signal?.throwIfAborted(); return null; }
}

/** Every audio programme needs at least one project-rate float32 plane. */
export function assertMinimumVideoAudioWindow(durationSeconds: number, projectRate: number): void {
	if (!fits(secondsToSampleFrame(durationSeconds, projectRate, 'point'), 1)) throw new VideoAudioOutputLimitError();
}

/** An authored output refusal must not be converted into a decoder fallback. */
export function planVideoAudioWorkload(workload: VideoAudioWorkload | null, durationSeconds: number,
	projectRate: number, nativeContextRate: number): Readonly<{ nativeWholeFile: boolean; ffmpegWholeFile: boolean }> {
	if (!workload) return { nativeWholeFile: true, ffmpegWholeFile: true };
	if (!fits(secondsToSampleFrame(durationSeconds, projectRate, 'point'), workload.channelCount)) throw new VideoAudioOutputLimitError();
	return {
		nativeWholeFile: fits(resampledFrames(workload.codedFrameCount, workload.sampleRate, Math.max(projectRate, nativeContextRate)), workload.channelCount),
		ffmpegWholeFile: fits(resampledFrames(workload.codedFrameCount, workload.sampleRate, Math.max(projectRate, workload.sampleRate)), workload.channelCount),
	};
}

/** Check actual geometry before planar copying, source-rate alignment or canonical resampling. */
export function assertDecodedVideoAudioWorkload(decoded: ImportedVideoDecodedAudio, durationSeconds: number,
	projectRate: number, offsetSeconds = 0): void {
	const channels = 'getChannelData' in decoded ? decoded.numberOfChannels : decoded.channels.length;
	if (!Number.isSafeInteger(channels) || channels < 0 || channels > 32 || !Number.isSafeInteger(decoded.sampleRate)
		|| decoded.sampleRate < 1 || decoded.sampleRate > 768_000) throw new RangeError('The decoded video audio geometry is invalid.');
	if (channels === 0) return;
	if (!fits(secondsToSampleFrame(durationSeconds, projectRate, 'point'), channels)) throw new VideoAudioOutputLimitError();
	const frames = 'getChannelData' in decoded
		? 'length' in decoded && typeof decoded.length === 'number' ? decoded.length : decoded.getChannelData(0).length
		: decoded.channels[0]?.length ?? 0;
	if (!fits(frames, channels) || !fits(resampledFrames(frames, decoded.sampleRate, projectRate), channels)
		|| offsetSeconds !== 0 && !fits(Math.ceil(durationSeconds * decoded.sampleRate), channels)) throw new VideoAudioWholeFileLimitError();
	for (let channel = 0; channel < channels; channel++) {
		const plane = 'getChannelData' in decoded ? decoded.getChannelData(channel) : decoded.channels[channel];
		if (plane?.length !== frames) throw new RangeError('The decoded video audio channel lengths differ.');
	}
}
function fits(frames: number, channels: number): boolean {
	const bytes = frames * channels * Float32Array.BYTES_PER_ELEMENT;
	return Number.isSafeInteger(frames) && frames > 0 && Number.isSafeInteger(bytes) && bytes <= MAXIMUM_PCM_BYTES;
}
function resampledFrames(frames: number, from: number, to: number): number {
	if (!Number.isSafeInteger(frames * to) || !Number.isSafeInteger(from) || from < 1 || !Number.isSafeInteger(to) || to < 1 || to > 768_000) return Infinity;
	return Math.ceil(frames * to / from);
}

async function readMovie(file: Blob, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
	const read = async (start: number, length: number): Promise<Uint8Array<ArrayBuffer>> => {
		const bytes = await raceAbortableRead(() => file.slice(start, start + length).arrayBuffer(), signal);
		signal?.throwIfAborted();
		if (bytes.byteLength !== length) throw new RangeError('Incomplete movie metadata.');
		return new Uint8Array(bytes);
	};
	let movie: Uint8Array<ArrayBuffer> | null = null;
	for (let offset = 0, headers = 0; offset < file.size;) {
		if (++headers > MAXIMUM_HEADERS || file.size - offset < 8) return null;
		const header = await read(offset, 8), view = new DataView(header.buffer);
		const type = String.fromCharCode(...header.subarray(4, 8));
		let size = view.getUint32(0), width = 8;
		if (size === 1) { if (file.size - offset < 16) return null; size = Number(new DataView((await read(offset + 8, 8)).buffer).getBigUint64(0)); width = 16; }
		else if (size === 0) size = file.size - offset;
		if (!Number.isSafeInteger(size) || size < width || size > file.size - offset || type === 'moof') return null;
		if (type === 'moov') {
			if (movie || size > MAXIMUM_MOVIE_BYTES) return null;
			movie = await read(offset + width, size - width);
		}
		offset += size;
	}
	return movie;
}

function codedAacPacketCount(bytes: Uint8Array, trackId: number, rate: number, fileSize: number): number | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let headers = 0;
	const children = (parent: Box): readonly Box[] => {
		const result: Box[] = [];
		for (let start = parent.body; start < parent.end;) {
			if (++headers > MAXIMUM_HEADERS || parent.end - start < 8) throw new RangeError('Movie header bound.');
			let size = view.getUint32(start), width = 8;
			const type = String.fromCharCode(...bytes.subarray(start + 4, start + 8));
			if (size === 1) { if (parent.end - start < 16) throw new RangeError('Movie header extent.'); size = Number(view.getBigUint64(start + 8)); width = 16; }
			else if (size === 0) size = parent.end - start;
			if (!Number.isSafeInteger(size) || size < width || size > parent.end - start) throw new RangeError('Movie box extent.');
			result.push({ type, body: start + width, end: start + size }); start += size;
		}
		return result;
	};
	const one = (parent: Box, type: string): Box | null => {
		const matches = children(parent).filter(box => box.type === type);
		return matches.length === 1 ? matches[0]! : null;
	};
	const word = (box: Box, offset: number): number => {
		if (offset < 0 || offset + 4 > box.end - box.body) throw new RangeError('Movie field extent.');
		return view.getUint32(box.body + offset);
	};
	const root = { type: 'moov', body: 0, end: bytes.length }, tracks = children(root);
	if (tracks.some(box => box.type === 'mvex')) return null;
	const selected = tracks.filter(box => box.type === 'trak').filter(track => {
		const header = one(track, 'tkhd'); if (!header) return false;
		const version = word(header, 0) >>> 24;
		return version <= 1 && word(header, version === 1 ? 20 : 12) === trackId;
	});
	if (selected.length !== 1) return null;
	const media = one(selected[0]!, 'mdia'); if (!media) return null;
	const header = one(media, 'mdhd'), handler = one(media, 'hdlr'); if (!header || !handler || word(handler, 8) !== 0x736f756e) return null;
	const version = word(header, 0) >>> 24; if (version > 1 || word(header, version === 1 ? 20 : 12) !== rate) return null;
	const minimum = one(media, 'minf'), table = minimum && one(minimum, 'stbl'); if (!table) return null;
	const sizes = one(table, 'stsz'), timing = one(table, 'stts'), descriptions = one(table, 'stsd');
	if (!sizes || !timing || !descriptions || word(descriptions, 0) !== 0 || word(descriptions, 4) !== 1
		|| word(sizes, 0) !== 0 || word(timing, 0) !== 0) return null;
	const size = word(sizes, 4), count = word(sizes, 8);
	if (!count || sizes.end - sizes.body !== 12 + (size ? 0 : count * 4)) return null;
	let encodedBytes = size * count;
	if (!size) for (let index = 0; index < count; index++) { const length = word(sizes, 12 + index * 4); if (!length) return null; encodedBytes += length; }
	if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 1 || encodedBytes > fileSize) return null;
	const entries = word(timing, 4); if (!entries || entries > 1024 || timing.end - timing.body !== 8 + entries * 8) return null;
	let samples = 0;
	for (let index = 0; index < entries; index++) {
		const repeat = word(timing, 8 + index * 8), duration = word(timing, 12 + index * 8);
		if (!repeat || !duration || duration > 1024 || duration !== 1024 && (index !== entries - 1 || repeat !== 1)) return null;
		samples += repeat;
	}
	return samples === count ? count : null;
}
