/* SPDX-License-Identifier: AGPL-3.0-only */
import type { LocalAssistanceBridge } from '../../../../assistance/local-assistance-bridge.ts';
import type { LocalAssistanceVideoKeyingRun } from './local-assistance-video-keying-publication.ts';
import { createFullRasterKeyingVideoDecoder, KeyingBrowserVideoDecodeError } from './local-assistance-video-keying-decoder.ts';
import type { FullRasterKeyingVideoDecoder } from './local-assistance-video-keying-frames.ts';

const READ_BYTES = 4 * 1024 ** 2;
/** Browser codecs stay on the browser path; unsupported codecs use the authenticated native decoder. */
export function createKeyingVideoDecoderWithNativeFallback(bridge: LocalAssistanceBridge,
	browser = createFullRasterKeyingVideoDecoder) {
	return async (body: Blob, run: LocalAssistanceVideoKeyingRun, signal: AbortSignal): Promise<FullRasterKeyingVideoDecoder> => {
		try { return await browser(body, run, signal); }
		catch (failure) {
			signal.throwIfAborted();
			if (!(failure instanceof KeyingBrowserVideoDecodeError) || !bridge.videoKeying?.decodeSource || !bridge.videoKeying.readDecodedSource) throw failure;
		}

		return createNativeDecoder(bridge, body, run, signal);
	};
}

async function createNativeDecoder(bridge: LocalAssistanceBridge, body: Blob, run: LocalAssistanceVideoKeyingRun, signal: AbortSignal): Promise<FullRasterKeyingVideoDecoder> {
	const decode = bridge.videoKeying!.decodeSource!, read = bridge.videoKeying!.readDecodedSource!;
	const { jobId } = await bridge.createJob();
	let closed = false; let cancellation: Promise<unknown> | undefined; let disposal: Promise<void> | undefined;
	const cancel = () => { cancellation ??= bridge.cancel(jobId); void cancellation.catch(() => undefined); };
	const dispose = () => disposal ??= (async () => {
		closed = true; signal.removeEventListener('abort', cancel);
		if (signal.aborted) cancel();
		try { await cancellation; } finally { await bridge.release(jobId); }
	})();
	signal.addEventListener('abort', cancel, { once: true });
	try {
		if (signal.aborted) cancel(); signal.throwIfAborted();
		const mediaType = !body.type || body.type === 'application/octet-stream' ? String(run.source.mimeType ?? '') : body.type;
		const source = await bridge.stageInput({ jobId, role: 'video', mediaType, byteLength: body.size, bytes: body });
		signal.throwIfAborted();
		const decoded = await decode({ contractVersion: 1, jobId, source, width: run.width, height: run.height,
			frameCount: run.sourceFrameCount, frameRate: run.frameRate });
		signal.throwIfAborted();
		if (decoded.jobId !== jobId || decoded.sourceSha256 !== source.sha256 || decoded.width !== run.width
			|| decoded.height !== run.height || decoded.frameCount !== run.sourceFrameCount
			|| decoded.byteLength !== run.width * run.height * run.sourceFrameCount * 4) throw new Error('Native keying source geometry changed.');
		return Object.freeze({ async capture(_timestamp: number, captureSignal: AbortSignal, ordinal?: number) {
			captureSignal.throwIfAborted(); signal.throwIfAborted();
			if (closed || typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= run.sourceFrameCount) throw new RangeError('Invalid native keying source ordinal.');
			const rgba = new Uint8Array(run.width * run.height * 4);
			for (let offset = 0; offset < rgba.length; offset += READ_BYTES) {
				captureSignal.throwIfAborted(); signal.throwIfAborted();
				const maximumBytes = Math.min(READ_BYTES, rgba.length - offset);
				const chunk = await read({ jobId, offset: ordinal * rgba.length + offset, maximumBytes });
				if (chunk.length !== maximumBytes) throw new Error('Native keying source read omitted pixels.');
				rgba.set(chunk, offset);
			}
			captureSignal.throwIfAborted(); signal.throwIfAborted(); return rgba;
		}, dispose });
	} catch (error) {
		const [cleanup] = await Promise.allSettled([dispose()]);
		if (cleanup!.status === 'rejected') throw new AggregateError([error, cleanup.reason], 'Native keying decode and cleanup failed.', { cause: error });
		throw error;
	}
}
