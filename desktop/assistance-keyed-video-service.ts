/* SPDX-License-Identifier: AGPL-3.0-only */

/** Encode completed, authenticated RGBA output claims into a separately owned WebM claim. */
import { dirname } from 'node:path';
import { curatedExternalFfmpegEnvironment } from './external-ffmpeg-environment.ts';
import type { AssistanceStagingRegistry } from './assistance-staging-registry.ts';
import type { createAssistanceOperationService } from './assistance-operation-service.ts';
import type { ExternalFfmpegPreferenceService, ExternalFfmpegRuntimeAdmission } from './external-ffmpeg-preference-service.ts';
import { externalFfmpegExecutablePairFromRuntimeAdmission, externalFfmpegExecutablePairMatches } from './external-ffmpeg-executable-pair-admission.ts';
import { sha256ExternalFfmpegRegularFile } from './external-ffmpeg-process-security.ts';
import { closeExternalFfmpegVideoInput, launchExternalFfmpegVideoProcess, writeExternalFfmpegVideoInput } from './external-ffmpeg-video-process.ts';
import { inspectKeyedVideoProbe, keyedVideoEncodeArguments, validateAssistanceKeyedVideoRequest } from './assistance-keyed-video-contract.ts';
import { openAssistanceKeyedVideoFrames } from './assistance-keyed-video-frames.ts';
import { assertKeyedVideoAlphaHashes, captureKeyedVideoProcess } from './assistance-keyed-video-process.ts';

type Operations = Pick<ReturnType<typeof createAssistanceOperationService>, 'assertJob' | 'openOutput'>;
type Registry = Pick<AssistanceStagingRegistry, 'reserveOutput' | 'resolveOutputReservationPathForMain' | 'authenticateOutput'>;

export function createAssistanceKeyedVideoService(options: Readonly<{
	operations: Operations;
	registry: Registry;
	preferences: Pick<ExternalFfmpegPreferenceService, 'admission' | 'invalidateAdmission'>;
}>) {
	const active = new Map<string, Readonly<{ controller: AbortController; completion: Promise<unknown> }>>();
	let disposed = false;
	const perform = async (value: unknown, signal: AbortSignal) => {
		const request = validateAssistanceKeyedVideoRequest(value);
		options.operations.assertJob(request.jobId);
		const admission = options.preferences.admission();
		const pair = externalFfmpegExecutablePairFromRuntimeAdmission(admission);
		if (!supportsKeyedVideo(admission) || !pair) {
			throw new Error('An admitted external FFmpeg with VP9 alpha encoding and decoding is required.');
		}
		const assertIdentity = async (): Promise<void> => {
			signal.throwIfAborted();
			const unchanged = options.preferences.admission() === admission && await externalFfmpegExecutablePairMatches(pair,
				(path) => sha256ExternalFfmpegRegularFile(path, { notRegularFile: () => new Error('The admitted executable is no longer regular.') }))
				&& options.preferences.admission() === admission;
			if (!unchanged) {
				await options.preferences.invalidateAdmission(admission, 'identity-changed');
				throw new Error('The admitted external FFmpeg executable identity changed.');
			}
		};
		await assertIdentity();
		const frames = await openAssistanceKeyedVideoFrames(request.outputs,
			(claim) => options.operations.openOutput({ jobId: request.jobId, claim }), request.frameRate, signal);
		try {
			// A bounded maximum is reserved before the process sees its private output path.
			const maximumByteLength = Math.min(8 * 1024 ** 3,
				frames.width * frames.height * 4 * frames.frameCount + 16 * 1024 ** 2);
			const reservation = await options.registry.reserveOutput({ jobId: request.jobId,
				role: 'keyed-video', mediaType: 'video/webm', maximumByteLength });
			const path = await options.registry.resolveOutputReservationPathForMain(request.jobId, reservation, signal);
			const directory = dirname(path);
			const encoding = new AbortController();
			const encodingSignal = AbortSignal.any([signal, encoding.signal]);
			const process = launchExternalFfmpegVideoProcess({ executablePath: pair.executablePath,
				arguments: keyedVideoEncodeArguments(frames, path, maximumByteLength), scratchDirectory: directory,
				hasAudio: false, signal: encodingSignal, environment: curatedExternalFfmpegEnvironment(globalThis.process.env),
				limits: { duration: 6 * 60 * 60_000, log: 1024 * 1024, terminationGrace: 1000, killWait: 5000 },
				error: (_reason, message) => new Error(message),
			});
			// Supervision can reject while the producer is still feeding its private pipe.
			void process.completion.catch(() => undefined);
			process.videoInput.on('error', () => undefined);
			try {
				await frames.consume((rgba) => writeExternalFfmpegVideoInput(process.videoInput, rgba, signal));
				await closeExternalFfmpegVideoInput(process.videoInput, signal);
				await process.completion;
			} catch (error) {
				process.videoInput.destroy();
				encoding.abort(error);
				await process.completion.catch(() => undefined);
				throw error;
			}
			const rawProbe = await captureKeyedVideoProcess({ executablePath: pair.ffprobePath, directory, signal,
				maximumBytes: 32 * 1024 ** 2, arguments: ['-v', 'error', '-protocol_whitelist', 'file',
					'-show_streams', '-show_packets', '-show_format', '-show_entries',
					'format=duration:stream=codec_type,codec_name,width,height,time_base,r_frame_rate,color_primaries,color_transfer,color_space,color_range:stream_tags=alpha_mode:packet=pts,duration',
					'-of', 'json', path] });
			const inspection = inspectKeyedVideoProbe(JSON.parse(rawProbe), frames);
			const alpha = await captureKeyedVideoProcess({ executablePath: pair.executablePath, directory, signal,
				maximumBytes: 16 * 1024 ** 2, arguments: ['-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe',
					'-c:v', 'libvpx-vp9', '-i', path, '-map', '0:v:0', '-an', '-sn', '-dn',
					'-vf', 'alphaextract', '-fps_mode', 'passthrough', '-f', 'framemd5', '-hash', 'sha256', 'pipe:1'] });
			assertKeyedVideoAlphaHashes(alpha, frames.alphaSha256, frames.width, frames.height);
			await assertIdentity();
			const claim = await options.registry.authenticateOutput(request.jobId, reservation, signal);
			return Object.freeze({ contractVersion: 1 as const, jobId: request.jobId, sourceId: request.sourceId, claim,
				inspection: Object.freeze({ ...inspection, sha256: claim.sha256 }) });
		} finally { await frames.close(); }
	};
	const cancel = async (jobId: string): Promise<void> => {
		const run = active.get(jobId); if (!run) return;
		run.controller.abort(new DOMException('Alpha-video encoding was cancelled.', 'AbortError'));
		await run.completion.catch(() => undefined);
	};
	return Object.freeze({
		async available(): Promise<boolean> {
			if (disposed) return false;
			const admission = options.preferences.admission();
			const pair = externalFfmpegExecutablePairFromRuntimeAdmission(admission);
			if (!supportsKeyedVideo(admission) || !pair) return false;
			try {
				return options.preferences.admission() === admission && await externalFfmpegExecutablePairMatches(pair,
					(path) => sha256ExternalFfmpegRegularFile(path, { notRegularFile: () => new Error('The admitted executable is no longer regular.') }))
					&& options.preferences.admission() === admission;
			} catch { return false; }
		},
		encode(value: unknown) {
			const request = validateAssistanceKeyedVideoRequest(value);
			if (disposed || active.has(request.jobId)) return Promise.reject(new Error('The keyed-video encoder is unavailable or busy for this job.'));
			const controller = new AbortController();
			const completion = perform(request, controller.signal).catch((error: unknown) => {
				controller.abort(error); throw error;
			}).finally(() => { active.delete(request.jobId); });
			active.set(request.jobId, { controller, completion });
			return completion;
		}, cancel,
		async dispose(): Promise<void> { disposed = true; await Promise.all([...active.keys()].map(cancel)); },
	});
}

function supportsKeyedVideo(admission: ExternalFfmpegRuntimeAdmission | null): admission is ExternalFfmpegRuntimeAdmission {
	if (!admission) return false;
	const required = { encoders: ['libvpx-vp9', 'rawvideo'], decoders: ['libvpx-vp9', 'rawvideo'],
		muxers: ['webm', 'framemd5'], demuxers: ['rawvideo', 'matroska'], filters: ['split', 'format', 'alphaextract', 'alphamerge'] } as const;
	return Object.entries(required).every(([kind, values]) =>
		values.every((name) => admission.capabilities[kind as keyof typeof required].includes(name)));
}
