/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../wav.js';
import { inspectDecodedAudioSampleRate } from '../../audio-file-metadata.js';

const MAXIMUM_UPLOAD_BYTES = 100_000_000;
type DecodedAudio = Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>;

interface DecodeContext {
	decodeAudioData(value: ArrayBuffer): Promise<AudioBuffer>;
	close(): Promise<void>;
}

export interface FreesoundUploadFilePreparationRuntime {
	readonly createDecodeContext?: (options: AudioContextOptions) => DecodeContext;
	readonly encode?: typeof encodeWav;
	readonly maximumBytes?: number;
}

/** Convert browser-decodable audio that Freesound cannot ingest directly into 24-bit PCM WAV. */
export async function prepareFreesoundUploadFile(
	file: File,
	signal?: AbortSignal,
	runtime: FreesoundUploadFilePreparationRuntime = {},
): Promise<File> {
	signal?.throwIfAborted();
	const maximumBytes = runtime.maximumBytes ?? MAXIMUM_UPLOAD_BYTES;
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
		throw new RangeError('The Freesound upload byte limit is invalid.');
	}
	if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maximumBytes) {
		throw new RangeError('The input audio exceeds the 100 MB Freesound upload limit.');
	}
	const inputBytes = await file.arrayBuffer();
	signal?.throwIfAborted();
	const presentationDuration = await uploadPresentationDuration(file, inputBytes, signal);
	signal?.throwIfAborted();
	const sampleRate = inspectDecodedAudioSampleRate(inputBytes);
	const options: AudioContextOptions = { latencyHint: 'playback', ...(sampleRate ? { sampleRate } : {}) };
	let context: DecodeContext | null = null;
	let decoded: DecodedAudio | null = null;
	try {
		context = runtime.createDecodeContext?.(options) ?? createBrowserDecodeContext(options);
		decoded = await context.decodeAudioData(inputBytes);
	}
	catch { signal?.throwIfAborted(); }
	finally { await context?.close(); }
	signal?.throwIfAborted();
	if (!decoded?.length || presentationDuration !== null && decoded.length !== Math.round(presentationDuration * decoded.sampleRate)) {
		decoded = await recoverUploadAudio(file, signal, maximumBytes);
	}
	signal?.throwIfAborted();
	assertConvertedExtent(decoded.length, decoded.numberOfChannels, maximumBytes);
	const channels = Array.from(
		{ length: decoded.numberOfChannels },
		(_, channel) => decoded.getChannelData(channel),
	);
	const bytes = (runtime.encode ?? encodeWav)(channels, {
		sampleRate: decoded.sampleRate,
		bitDepth: 24,
		float: false,
		dither: 'triangular',
	});
	if (!(bytes instanceof Uint8Array) || bytes.byteLength > maximumBytes) {
		throw new RangeError('The converted audio exceeds the 100 MB Freesound upload limit.');
	}
	signal?.throwIfAborted();
	return new File([Uint8Array.from(bytes).buffer], `${fileStem(file.name)}.wav`, {
		type: 'audio/wav',
		lastModified: file.lastModified,
	});
}

/** Native decoders may retain samples outside an MP4's authored presentation. */
async function uploadPresentationDuration(file: File, bytes: ArrayBuffer, signal?: AbortSignal): Promise<number | null> {
	if (bytes.byteLength < 8) return null;
	const type = new TextDecoder().decode(new Uint8Array(bytes, 4, 4));
	if (!['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(type)) return null;
	const { Input, BlobSource, MP4 } = await import('mediabunny');
	const { readIsoAudioPresentationEnd } = await import('../../iso-audio-presentation-edit.ts');
	const input = new Input({ source: new BlobSource(file, { maxCacheSize: 4 * 1024 ** 2, useStreamReader: false }), formats: [MP4] });
	const retire = (): void => { input.dispose(); };
	signal?.addEventListener('abort', retire, { once: true });
	try {
		signal?.throwIfAborted();
		const track = await input.getPrimaryAudioTrack();
		signal?.throwIfAborted();
		if (!track) return null;
		const end = await readIsoAudioPresentationEnd(file, track.id, signal);
		if (end === null) return null;
		const [first, last] = await Promise.all([track.getFirstTimestamp(), track.computeDuration()]);
		signal?.throwIfAborted();
		return Math.min(end, last) - Math.max(0, first);
	} finally { signal?.removeEventListener('abort', retire); input.dispose(); }
}

async function recoverUploadAudio(file: File, signal: AbortSignal | undefined, maximumBytes: number): Promise<DecodedAudio> {
	const signature = new TextDecoder().decode(await file.slice(0, 4).arrayBuffer());
	signal?.throwIfAborted();
	if (signature === 'FORM') {
		const { inspectAiffBlobPcm, streamAiffBlobPcm } = await import('../../aiff-pcm-chunk-reader.ts');
		const descriptor = await inspectAiffBlobPcm(file, { signal });
		return collectUploadPcm(descriptor, maximumBytes, onChunk => streamAiffBlobPcm(file, { descriptor, signal, onChunk }));
	}
	if (['RIFF', 'RF64', 'BW64'].includes(signature)) {
		const { inspectWavBlobPcm, streamWavBlobPcm } = await import('../../wav-import.js');
		const descriptor = await inspectWavBlobPcm(file, { signal });
		return collectUploadPcm(descriptor, maximumBytes, onChunk => streamWavBlobPcm(file, { descriptor, signal, onChunk }));
	}
	const { prepareStreamedAudioImport } = await import('../../browser-streamed-audio-import.ts');
	const prepared = await prepareStreamedAudioImport(file, { signal });
	try {
		return await collectUploadPcm(prepared.descriptor, maximumBytes,
			onChunk => prepared.stream({ chunkFrames: 65_536, signal, onChunk }));
	} finally { prepared.dispose(); }
}

async function collectUploadPcm(
	descriptor: Readonly<{ frameCount: number; channelCount: number; sampleRate: number }>,
	maximumBytes: number,
	stream: (onChunk: (packet: readonly Float32Array[]) => void) => Promise<unknown>,
): Promise<DecodedAudio> {
	assertConvertedExtent(descriptor.frameCount, descriptor.channelCount, maximumBytes);
	const channels = Array.from({ length: descriptor.channelCount }, () => new Float32Array(descriptor.frameCount));
	let offset = 0;
	await stream(packet => {
		packet.forEach((channel, index) => channels[index].set(channel, offset));
		offset += packet[0]?.length ?? 0;
	});
	return {
		length: descriptor.frameCount, sampleRate: descriptor.sampleRate, numberOfChannels: descriptor.channelCount,
		getChannelData: index => channels[index],
	};
}

function assertConvertedExtent(frames: number, channelCount: number, maximumBytes: number): void {
	const expectedBytes = frames * channelCount * 3 + 4_096;
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes > maximumBytes) {
		throw new RangeError('The converted audio exceeds the 100 MB Freesound upload limit.');
	}
}

function createBrowserDecodeContext(options: AudioContextOptions): DecodeContext {
	const scope = globalThis as typeof globalThis & {
		webkitAudioContext?: typeof AudioContext;
	};
	const Context = scope.AudioContext ?? scope.webkitAudioContext;
	if (!Context) throw new Error('This audio format cannot be decoded in this browser.');
	return new Context(options);
}

function fileStem(value: string): string {
	const stem = value.replace(/\\/gu, '/').split('/').at(-1)?.replace(/\.[^.]+$/u, '') ?? '';
	const safeStem = Array.from(stem, (character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 32 || codePoint === 127 || '/:*?"<>|'.includes(character) ? '-' : character;
	}).join('');
	return safeStem.replace(/^\.+/u, '').trim().slice(0, 220)
		|| 'soundscaper-audio';
}
