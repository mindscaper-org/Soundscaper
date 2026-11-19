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

/** Hash the exact planar PCM packets persisted by a model-audio source writer. */
export function createAssistanceSourcePcmIdentity() {
	const digest = sha256.create();
	const header = new Uint8Array(4);
	const view = new DataView(header.buffer);
	let byteLength = 0;
	return {
		update(channels: readonly Float32Array[]) {
			view.setUint32(0, channels[0]!.length, true);
			const pcm = new Uint8Array(packPlanarFloat32(channels));
			digest.update(header); digest.update(pcm);
			byteLength += header.byteLength + pcm.byteLength;
		},
		finish() { return { contentSha256: bytesToHex(digest.digest()), byteLength }; },
	};
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
	const pcmIdentity = createAssistanceSourcePcmIdentity();
	let writer: SourceWriter | null = null;
	let committed = false;
	try {
		writer = await store.beginSourceWrite(sourceId, {
			name: source.name, mimeType: 'audio/wav', sampleFormat: 'float32',
			sampleRate, channelCount, chunkFrames,
		});
		const chunks = createPlanarPcmChunkCoalescer({ chunkFrames,
			onChunk: async (channels: readonly Float32Array[]) => {
				pcmIdentity.update(channels);
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
		const identity = pcmIdentity.finish();
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
