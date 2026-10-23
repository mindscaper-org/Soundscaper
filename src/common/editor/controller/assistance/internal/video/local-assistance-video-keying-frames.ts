/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAssistanceVisualFramePackV2, type AssistanceVisualFramePackV2FrameDraft } from '../../../../assistance/visual-frame-pack-v2.ts';
import { digestMediaContent } from '../../../../storage/media-content-digest.ts';
import type { LocalAssistanceVideoKeyingRun } from './local-assistance-video-keying-publication.ts';
import { KEYING_FRAME_PACK_TYPE, KEYING_MAXIMUM_PACK_BYTES, type VideoKeyingProgress } from './local-assistance-video-keying-workflow.ts';
import { createFullRasterKeyingVideoDecoder } from './local-assistance-video-keying-decoder.ts';
import { KEYING_PACK_HEADER_BYTES as HEADER_BYTES, assertKeyingStagedBudget, keyingEncodedReservationBytes } from './local-assistance-video-keying-budget.ts';

export interface FullRasterKeyingVideoDecoder {
	capture(timestampSeconds: number, signal: AbortSignal, sourceFrame?: number): Promise<Uint8Array>;
	dispose(): void | Promise<void>;
}
export interface VideoKeyingFramePreparationDependencies {
	readonly loadOriginal: (run: LocalAssistanceVideoKeyingRun, signal: AbortSignal) => Promise<Blob | null>;
	readonly createDecoder?: (body: Blob, run: LocalAssistanceVideoKeyingRun, signal: AbortSignal) => Promise<FullRasterKeyingVideoDecoder>;
	readonly maximumPackBytes?: number;
}
interface FrameOptions {
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly onProgress?: (value: VideoKeyingProgress) => void;
}

/** Full-raster source decode is separate from the intentionally downscaled preview extractor. */
export function createLocalAssistanceVideoKeyingFramePreparation(dependencies: VideoKeyingFramePreparationDependencies) {
	return async function* prepare(run: LocalAssistanceVideoKeyingRun, options: FrameOptions): AsyncIterable<Blob> {
		const current = (): void => { options.signal.throwIfAborted(); options.assertCurrent(); };
		current();
		if (run.width > 4_096 || run.height > 4_096) throw new RangeError('CorridorKey supports source rasters up to 4096 pixels per axis.');
		const frameBytes = run.width * run.height * 4;
		const maximum = dependencies.maximumPackBytes ?? KEYING_MAXIMUM_PACK_BYTES;
		if (!Number.isSafeInteger(maximum) || maximum > KEYING_MAXIMUM_PACK_BYTES || maximum < HEADER_BYTES + 16 + frameBytes) {
			throw new RangeError('The full-raster keying frame pack cannot fit one source frame.');
		}
		const perPack = Math.floor((maximum - HEADER_BYTES) / (16 + frameBytes));
		const count = Math.ceil(run.sourceFrameCount / perPack);
		assertKeyingStagedBudget(run.sourceFrameCount * (frameBytes + 16) + count * HEADER_BYTES, count,
			keyingEncodedReservationBytes(run.width, run.height, run.sourceFrameCount));
		const body = await dependencies.loadOriginal(run, options.signal);
		current();
		if (!body || body.size > 8 * 1024 ** 3 || await digestMediaContent(body, { signal: options.signal }) !== run.source.contentSha256) {
			throw new Error('The full original video is unavailable or changed before keying.');
		}
		current();
		const decoder = await (dependencies.createDecoder ?? createFullRasterKeyingVideoDecoder)(body, run, options.signal);
		let failure: unknown;
		try {
			let frames: AssistanceVisualFramePackV2FrameDraft[] = [];
			for (let ordinal = 0; ordinal < run.sourceFrameCount; ordinal += 1) {
				current();
				const start = run.presentationTick(ordinal);
				const end = ordinal + 1 === run.sourceFrameCount ? run.sourceEndTick : run.presentationTick(ordinal + 1);
				const timestamp = Number(start + end) / (2 * run.timescale);
				const rgba = await decoder.capture(timestamp, options.signal, ordinal);
				current();
				if (!(rgba instanceof Uint8Array) || rgba.byteLength !== frameBytes) throw new Error('The keying decoder changed the full source raster.');
				for (let offset = 3; offset < rgba.byteLength; offset += 4) {
					if (rgba[offset] !== 255) throw new Error('CorridorKey currently requires an opaque source; the decoded video already contains transparency.');
				}
				frames.push({ sourceFrame: ordinal, presentationTick: start.toString(), rgba });
				options.onProgress?.({ phase: 'decoding', completed: ordinal + 1, total: run.sourceFrameCount });
				if (frames.length === perPack || ordinal + 1 === run.sourceFrameCount) {
					const chunks = createAssistanceVisualFramePackV2({ sourceWidth: run.width, sourceHeight: run.height,
						rasterWidth: run.width, rasterHeight: run.height, timescale: run.timescale, frames });
					yield new Blob(chunks.map((chunk) => Uint8Array.from(chunk)), { type: KEYING_FRAME_PACK_TYPE });
					frames = [];
				}
			}
		} catch (error) { failure = error; }
		finally {
			try { await decoder.dispose(); }
			catch (cleanup) { failure = failure === undefined ? cleanup : new AggregateError([failure, cleanup],
				'Video keying decode and cleanup failed.', { cause: failure }); }
		}
		if (failure !== undefined) throw failure;
	};
}
