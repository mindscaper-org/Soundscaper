/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StreamedAudioImportSession } from './browser-streamed-audio-import.ts';
import type { WavPackImportGroupDecoder } from './browser-streamed-wavpack-import.ts';
import type { BrowserContainerAudioSample } from './browser-container-audio-decode.ts';

import { initialAacSbrError } from './aac-initial-profile-error.ts';

const MAXIMUM_READ_BYTES = 4 * 1024 * 1024;
const SAMPLE_FRAMES = 65_536;
const AAC_PACKET_FRAMES = 1024;

type SourceGeometry = Omit<StreamedAudioImportSession, 'samples' | 'dispose'>;

/** Admit source geometry without imposing the bounded utility tier's caps on external FFmpeg. */
export function canUseDesktopAacImport(file: Blob, geometry: Pick<SourceGeometry, 'sampleRate' | 'channelCount' | 'durationSeconds'>): boolean {
	const frames = Math.round(geometry.sampleRate * geometry.durationSeconds);
	const bytes = (frames + AAC_PACKET_FRAMES * 2) * geometry.channelCount * 4;
	return Number.isSafeInteger(file.size) && file.size > 0 && Number.isSafeInteger(frames) && frames > 0
		&& Number.isSafeInteger(bytes) && bytes > 0;
}

/** AAC/M4A belongs to the main-owned bundled, operating-system, and external providers, including when Electron has no AAC decoder. */
export function openDesktopAacImportSession(
	file: Blob,
	geometry: SourceGeometry,
	codec: WavPackImportGroupDecoder,
	signal?: AbortSignal,
	leadingFrames = 0,
): StreamedAudioImportSession {
	signal?.throwIfAborted();
	if (!canUseDesktopAacImport(file, geometry) || (leadingFrames !== 0 && leadingFrames !== AAC_PACKET_FRAMES)) {
		throw new Error('Desktop AAC/M4A import requires valid source geometry and packet padding.');
	}
	const frames = Math.round(geometry.sampleRate * geometry.durationSeconds);
	const controller = new AbortController();
	let disposed = false;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		signal?.removeEventListener('abort', onAbort);
		controller.abort(signal?.reason);
	};
	const onAbort = (): void => { dispose(); };
	signal?.addEventListener('abort', onAbort, { once: true });
	const assertCurrent = (): void => {
		signal?.throwIfAborted();
		if (disposed) throw new Error('The desktop AAC/M4A import session is closed.');
	};
	return Object.freeze({ ...geometry, dispose,
		async *samples(): AsyncGenerator<BrowserContainerAudioSample> {
			assertCurrent();
			const decoded = await decodeAac(file, codec, (frames + AAC_PACKET_FRAMES * 2) * geometry.channelCount * 4, controller.signal);
			assertCurrent();
			assertPcmGeometry(decoded, geometry, frames, leadingFrames, AAC_PACKET_FRAMES);
			yield* pcmSamples(decoded.channels, geometry, frames, leadingFrames, assertCurrent);
		},
	});
}


/** Resolve an implicitly signaled HE-AAC clock before publishing the track geometry. */
export async function openDesktopAacImport(
	file: Blob, geometry: SourceGeometry, codec: WavPackImportGroupDecoder, config: AudioDecoderConfig | null,
	signal?: AbortSignal, leadingFrames = 0,
): Promise<StreamedAudioImportSession> {
	const mayExpand = config && canExpand(config, geometry, geometry.sampleRate * 2, geometry.channelCount);
	if (!mayExpand) return openDesktopAacImportSession(file, geometry, codec, signal, leadingFrames);
	const requestedChannels = Math.max(2, geometry.channelCount);
	const maximumOutputBytes = (Math.ceil(geometry.durationSeconds * geometry.sampleRate * 2) + 4096) * requestedChannels * 4;
	const decoded = await decodeAac(file, codec, maximumOutputBytes, signal);
	signal?.throwIfAborted();
	const expanded = canExpand(config, geometry, decoded.sampleRate, decoded.channels.length);
	const resolved = expanded ? { ...geometry, sampleRate: decoded.sampleRate, channelCount: decoded.channels.length } : geometry;
	const frames = Math.round(resolved.durationSeconds * resolved.sampleRate);
	assertPcmGeometry(decoded, resolved, frames, leadingFrames, expanded ? AAC_PACKET_FRAMES * 2 : AAC_PACKET_FRAMES);
	let pcm: readonly Float32Array[] | null = decoded.channels;
	const assertCurrent = () => {
		signal?.throwIfAborted();
		if (pcm === null) throw new Error('The desktop AAC/M4A import session is closed.');
	};
	return Object.freeze({ ...resolved, dispose() { pcm = null; },
		async *samples() {
			assertCurrent();
			yield* pcmSamples(pcm!, resolved, frames, leadingFrames, assertCurrent);
		},
	});
}

function canExpand(config: AudioDecoderConfig, source: SourceGeometry, sampleRate: number, channelCount: number): boolean {
	if (config.codec !== 'mp4a.40.2' || source.sampleRate < 8_000 || source.sampleRate > 48_000
		|| sampleRate !== source.sampleRate * 2 || (source.channelCount !== 1 && source.channelCount !== 2)
		|| (channelCount !== source.channelCount && !(source.channelCount === 1 && channelCount === 2))) return false;
	// ADTS declares its AAC-LC core in the transport header and has no ASC.
	return config.description === undefined || initialAacSbrError(config, { sampleRate, numberOfChannels: channelCount }) !== null;
}

async function decodeAac(file: Blob, codec: WavPackImportGroupDecoder, maximumOutputBytes: number, signal?: AbortSignal) {
	const parts: ArrayBuffer[] = [];
	for (let offset = 0; offset < file.size; offset += MAXIMUM_READ_BYTES) {
		signal?.throwIfAborted();
		parts.push(await file.slice(offset, Math.min(file.size, offset + MAXIMUM_READ_BYTES)).arrayBuffer());
	}
	signal?.throwIfAborted();
	const name = 'name' in file && typeof file.name === 'string' ? file.name : 'selected.m4a';
	return await codec.decode(new File(parts, name, { type: file.type || 'audio/mp4' }), {
		format: 'aac-m4a', signal, maximumOutputBytes,
	});
}

function assertPcmGeometry(decoded: Awaited<ReturnType<WavPackImportGroupDecoder['decode']>>,
	geometry: SourceGeometry, frames: number, leadingFrames: number, packetFrames: number): void {
	const expectedFrames = frames + leadingFrames;
	const decodedFrames = decoded.channels[0]?.length;
	if (decoded.sampleRate !== geometry.sampleRate || decoded.channels.length !== geometry.channelCount
		|| decodedFrames === undefined || decodedFrames < expectedFrames || decodedFrames >= expectedFrames + packetFrames
		|| decoded.channels.some(channel => !(channel instanceof Float32Array) || channel.length !== decodedFrames)) {
		throw new Error('The desktop AAC/M4A utility returned different PCM geometry.');
	}
}

function* pcmSamples(channels: readonly Float32Array[], geometry: SourceGeometry, frames: number,
	leadingFrames: number, assertCurrent: () => void): Generator<BrowserContainerAudioSample> {
	for (let offset = 0; offset < frames; offset += SAMPLE_FRAMES) {
		assertCurrent();
		const count = Math.min(SAMPLE_FRAMES, frames - offset);
		yield {
			timestamp: geometry.timelineOrigin + offset / geometry.sampleRate,
			sampleRate: geometry.sampleRate, numberOfChannels: geometry.channelCount,
			numberOfFrames: count, duration: count / geometry.sampleRate,
			copyTo(destination, options) {
				const from = leadingFrames + offset + (options.frameOffset ?? 0);
				destination.set(channels[options.planeIndex]!.subarray(from, from + (options.frameCount ?? count)));
			}, close() {},
		};
	}
}
