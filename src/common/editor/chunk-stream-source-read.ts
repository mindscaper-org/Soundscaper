/* SPDX-License-Identifier: AGPL-3.0-only */

import { serializeChunkStreamError, transferListForAudioChannels } from './chunk-stream.js';
import { readSourceWithRecovery } from './storage/source-read-recovery.ts';

interface StorageChunkRequest {
	readonly requestId: number;
	readonly chunkIndex: number;
	readonly frameStart: number;
	readonly frames: number;
}
interface ChunkStreamSource {
	readonly channelCount: number;
	readonly boundedReads?: boolean;
	readStorageChunk(index: number, context: Readonly<{
		signal: AbortSignal; streamId: string; frameStart: number; frames: number;
	}>): unknown;
}
interface ReadingChunkStream {
	readonly id: string;
	readonly source: ChunkStreamSource;
	readonly abortController: AbortController;
	readonly settled: boolean;
}
interface StorageWorker {
	postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
}

/** Bound storage calls even when a provider ignores abort, with every late failure observed. */
export async function provideChunkStreamStorageChunk(
	stream: ReadingChunkStream,
	request: StorageChunkRequest,
	getWorker: () => StorageWorker | null,
	fail: (error: unknown) => void,
	timeoutMs: number,
): Promise<void> {
	if (stream.settled || stream.abortController.signal.aborted) return;
	try {
		// Linked range providers already retry. This outer watchdog must not multiply retries.
		const read = (signal: AbortSignal) => stream.source.readStorageChunk(request.chunkIndex, {
			signal, streamId: stream.id, frameStart: request.frameStart, frames: request.frames,
		});
		// Linked originals verify a whole-file digest before their first PCM chunk;
		// each admitted range has its own deadline, so healthy large files may take longer.
		const result = stream.source.boundedReads
			? await read(stream.abortController.signal)
			: await readSourceWithRecovery(read, { signal: stream.abortController.signal, maximumAttempts: 1, attemptTimeoutMs: timeoutMs });
		if (stream.settled || stream.abortController.signal.aborted) return;
		const value = result && typeof result === 'object' && 'channels' in result ? result.channels : result;
		const channels = normalizeStorageChannels(value, stream.source.channelCount, request.frames);
		getWorker()?.postMessage({ type: 'storage-chunk', streamId: stream.id,
			requestId: request.requestId, chunkIndex: request.chunkIndex, channels }, channels.map(channel => channel.buffer));
	} catch (error) {
		if (stream.settled || stream.abortController.signal.aborted) return;
		try {
			getWorker()?.postMessage({ type: 'storage-error', streamId: stream.id,
				requestId: request.requestId, chunkIndex: request.chunkIndex,
				message: error instanceof Error ? error.message : String(error), error: serializeChunkStreamError(error) });
		} catch (postError) { fail(postError); }
	}
}

function normalizeStorageChannels(value: unknown, channelCount: number, frames: number): Float32Array<ArrayBuffer>[] {
	if (!Array.isArray(value) || value.length !== channelCount) {
		throw new TypeError(`A storage chunk must contain ${channelCount} planar channels.`);
	}
	return value.map((channel: unknown, index: number) => {
		if (!(channel instanceof Float32Array) || channel.length !== frames) {
			throw new RangeError(`Storage channel ${index} must contain ${frames} Float32 frames.`);
		}
		transferListForAudioChannels([channel]);
		return channel.slice();
	});
}
