/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createPlanarPcmChunkCoalescer } from '../../../../pcm-chunks.js';
import { createStreamingWindowedSincResampler } from '../../../../resample.js';
import { streamWavBlobPcm } from '../../../../wav-import.js';
import { packPlanarFloat32 } from '../../../../wavpack/pcm.js';
import type { LocalAssistanceAudioReviewedOutput } from './local-assistance-audio-result-custody.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type Awaitable<Value> = PromiseLike<Value> | Value;
interface SourceWriter {
	readonly framesWritten?: number;
	write(channels: readonly Float32Array[]): Awaitable<unknown>;
	commit(metadata?: DataRecord, options?: Readonly<{ ifAbsent?: boolean }>): Awaitable<unknown>;
	abort(reason?: unknown): Awaitable<unknown>;
}
interface SourceStore {
	beginSourceWrite(sourceId: string, metadata: DataRecord): Awaitable<SourceWriter>;
	deleteSource(sourceId: string): Promise<unknown>;
}

/** Persist at the ordinary project rate while retaining the authenticated model WAV in provenance. */
export async function publishLocalAssistanceAudioSource(
	store: SourceStore,
	source: DataRecord,
	output: LocalAssistanceAudioReviewedOutput,
	chunkFrames: number,
): Promise<DataRecord> {
	const sourceId = String(source.id);
	const sampleRate = Number(source.sampleRate);
	const frameCount = Number(source.frameCount);
	const channelCount = output.review.channelCount;
	const resampler = sampleRate === output.review.sampleRate ? null
		: createStreamingWindowedSincResampler(output.review.sampleRate, sampleRate, channelCount) as unknown as Readonly<{
				push(channels: Float32Array[]): Float32Array[];
				finish(outputFrames: number): Float32Array[];
			}>;
	const digest = sha256.create();
	let byteLength = 0;
	let writer: SourceWriter | null = null;
	let committed = false;
	try {
		writer = await store.beginSourceWrite(sourceId, {
			name: source.name, mimeType: 'audio/wav', sampleFormat: 'float32',
			sampleRate, channelCount, chunkFrames,
			...(!resampler ? { contentSha256: source.contentSha256, byteLength: source.byteLength } : {}),
		});
		const chunks = createPlanarPcmChunkCoalescer({ chunkFrames,
			onChunk: async (channels: readonly Float32Array[]) => {
				if (resampler) {
					const header = new Uint8Array(4);
					new DataView(header.buffer).setUint32(0, channels[0]!.length, true);
					const pcm = new Uint8Array(packPlanarFloat32(channels));
					digest.update(header); digest.update(pcm);
					byteLength += header.byteLength + pcm.byteLength;
				}
				await writer!.write(channels);
			},
		}) as unknown as Readonly<{
			write(channels: readonly Float32Array[]): Promise<void>;
			finalize(): Promise<Readonly<{ frameCount: number }>>;
		}>;
		await streamWavBlobPcm(output.bytes, { chunkFrames,
			onChunk: async (channels: Float32Array[]) => {
				await chunks.write(resampler ? resampler.push(channels) : channels);
			},
		});
		if (resampler) await chunks.write(resampler.finish(frameCount));
		const completed = await chunks.finalize();
		if (completed.frameCount !== frameCount
			|| writer.framesWritten !== undefined && writer.framesWritten !== frameCount) {
			throw new Error('The assistance WAV writer persisted inexact frame geometry.');
		}
		const identity = resampler
			? { contentSha256: bytesToHex(digest.digest()), byteLength }
			: { contentSha256: source.contentSha256, byteLength: source.byteLength };
		await writer.commit({ sampleRate, channelCount, chunkFrames, ...identity }, { ifAbsent: true });
		committed = true;
		return Object.freeze({ ...source, ...identity });
	} catch (error) {
		if (!committed) await Promise.resolve(writer?.abort(error)).catch(() => undefined);
		try { await store.deleteSource(sourceId); }
		catch (cleanupError) {
			throw new AggregateError([error, cleanupError],
				'Assistance audio source publication and cleanup both failed.', { cause: cleanupError });
		}
		throw error;
	}
}
