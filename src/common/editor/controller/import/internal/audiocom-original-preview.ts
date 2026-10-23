/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudiocomPreparedPreview, AudiocomSearchResult } from '../audiocom-panel-session.ts';
import type { WavPackImportGroupDecoder } from '../../../browser-streamed-wavpack-import.ts';
import { AudiocomApiError } from './audiocom-api-client.ts';

const MAXIMUM_SOURCE_BYTES = 64 * 1024 * 1024;
const MAXIMUM_PCM_BYTES = 128 * 1024 * 1024;

interface PreviewDependencies {
	readonly fetch?: typeof fetch;
	readonly createObjectUrl?: (blob: Blob) => string;
	readonly revokeObjectUrl?: (url: string) => void;
	readonly wavpackDecoder?: WavPackImportGroupDecoder;
}

/** Decode originals unsupported by media elements using the installed import codecs. */
export async function prepareAudiocomPreview(
	result: Pick<AudiocomSearchResult, 'previewUrl' | 'previewMime'>,
	signal: AbortSignal,
	dependencies: PreviewDependencies = {},
): Promise<AudiocomPreparedPreview> {
	signal.throwIfAborted();
	if (!result.previewUrl) throw new Error('The audio.com preview is unavailable.');
	const wavpack = result.previewMime === 'audio/x-wavpack' || result.previewMime === 'audio/wavpack';
	const aiff = result.previewMime === 'audio/aiff' || result.previewMime === 'audio/x-aiff';
	if (!wavpack && !aiff) return { url: result.previewUrl, dispose() {} };
	const response = await (dependencies.fetch ?? fetch)(result.previewUrl, { signal, credentials: 'include', redirect: 'error' });
	signal.throwIfAborted();
	if (!response.ok) {
		await response.body?.cancel();
		throw new AudiocomApiError(response.status, response.status === 401
			? 'The audio.com session expired.' : 'The audio.com original could not be downloaded for preview.');
	}
	const source = await boundedOriginal(response, signal);
	const { createWavStreamEncoder } = await import('../../../wav.js');
	const parts: BlobPart[] = [];
	const encoder = (sampleRate: number, channelCount: number, frameCount: number): ReturnType<typeof createWavStreamEncoder> => {
		if (!Number.isSafeInteger(frameCount) || frameCount < 1 || !Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 384_000
			|| !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 8 || frameCount * channelCount * 4 > MAXIMUM_PCM_BYTES) {
			throw new Error('This original exceeds the bounded preview size (128 MiB of PCM).');
		}
		return createWavStreamEncoder({ sampleRate, channelCount, totalFrames: frameCount, float: true, bitDepth: 32, collect: false,
			onChunk: (chunk: Uint8Array) => { signal.throwIfAborted(); parts.push(Uint8Array.from(chunk)); },
		});
	};
	let durationSeconds: number;
	if (aiff) {
		const { inspectAiffBlobPcm, createAiffBlobPcmChunkReader } = await import('../../../aiff-pcm-chunk-reader.ts');
		const descriptor = await inspectAiffBlobPcm(source, { signal });
		const output = encoder(descriptor.sampleRate, descriptor.channelCount, descriptor.frameCount);
		const reader = createAiffBlobPcmChunkReader(source, { descriptor });
		for (let index = 0; index < reader.chunkCount; index++) {
			const chunk = await reader.readChunk(index, { signal });
			output.write(chunk.channels);
		}
		output.finalize();
		durationSeconds = descriptor.frameCount / descriptor.sampleRate;
	} else {
		const { openStreamedWavPackImportSession } = await import('../../../browser-streamed-wavpack-import.ts');
		const session = await openStreamedWavPackImportSession(source, signal, dependencies.wavpackDecoder);
		try {
			const frameCount = Math.round(session.durationSeconds * session.sampleRate);
			const output = encoder(session.sampleRate, session.channelCount, frameCount);
			for await (const sample of session.samples()) {
				try {
					signal.throwIfAborted();
					const channels = Array.from({ length: session.channelCount }, (_value, planeIndex) => {
						const channel = new Float32Array(sample.numberOfFrames);
						sample.copyTo(channel, { planeIndex, format: 'f32-planar' });
						return channel;
					});
					output.write(channels);
				} finally { sample.close(); }
			}
			output.finalize();
			durationSeconds = frameCount / session.sampleRate;
		} finally { session.dispose(); }
	}
	signal.throwIfAborted();
	const url = (dependencies.createObjectUrl ?? URL.createObjectURL)(new Blob(parts, { type: 'audio/wav' }));
	let disposed = false;
	return { url, durationSeconds, dispose() {
		if (!disposed) { disposed = true; (dependencies.revokeObjectUrl ?? URL.revokeObjectURL)(url); }
	} };
}

async function boundedOriginal(response: Response, signal: AbortSignal): Promise<Blob> {
	const length = response.headers.get('Content-Length');
	if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAXIMUM_SOURCE_BYTES)) {
		await response.body?.cancel(); throw new Error('Original previews are limited to 64 MiB of source audio.');
	}
	if (!response.body) throw new Error('The audio.com original is empty.');
	const reader = response.body.getReader();
	const abort = (): void => { void reader.cancel(signal.reason).catch(() => undefined); };
	signal.addEventListener('abort', abort, { once: true });
	const parts: BlobPart[] = [];
	let size = 0;
	try {
		for (;;) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			size += value.byteLength;
			if (size > MAXIMUM_SOURCE_BYTES) { await reader.cancel(); throw new Error('Original previews are limited to 64 MiB of source audio.'); }
			parts.push(Uint8Array.from(value));
		}
		return new Blob(parts);
	} finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
