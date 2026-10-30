/* SPDX-License-Identifier: AGPL-3.0-only */
/** Fixed native source extraction over job-owned video, with bounded pathless RGBA reads. */
import { constants } from 'node:fs';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AssistanceStagingRegistry } from './assistance-staging-registry.ts';
import type { ExternalFfmpegPreferenceService } from './external-ffmpeg-preference-service.ts';
import { externalFfmpegExecutablePairFromRuntimeAdmission, externalFfmpegExecutablePairMatches } from './external-ffmpeg-executable-pair-admission.ts';
import { sha256ExternalFfmpegRegularFile } from './external-ffmpeg-process-security.ts';
import { guardExternalFfmpegVideoArguments } from './external-ffmpeg-video-process.ts';
import { captureKeyedVideoProcess } from './assistance-keyed-video-process.ts';
import { KEYING_SOURCE_READ_MAXIMUM_BYTES, keyingDecodeRecord, validateKeyingSourceDecodeRequest } from './assistance-keyed-video-decode-contract.ts';

interface DecodeState { readonly controller: AbortController; completion: Promise<unknown>; directory?: string; file?: FileHandle; byteLength?: number; cleanup?: Promise<void> }
interface ProbedStream {
	readonly width?: number; readonly height?: number; readonly r_frame_rate?: string;
	readonly sample_aspect_ratio?: string; readonly tags?: Readonly<{ rotate?: string }>;
	readonly side_data_list?: readonly Readonly<{ rotation?: number; displaymatrix?: string }>[];
}
export function createAssistanceKeyingSourceDecodeService(options: Readonly<{
	operations: Readonly<{ assertJob(jobId: string): void }>;
	registry: Pick<AssistanceStagingRegistry, 'resolveInputPathForMain'>;
	preferences: Pick<ExternalFfmpegPreferenceService, 'admission' | 'invalidateAdmission'>;
}>) {
	const jobs = new Map<string, DecodeState>(); let disposed = false;
	async function perform(request: ReturnType<typeof validateKeyingSourceDecodeRequest>, state: DecodeState) {
		const signal = state.controller.signal;
		const admission = options.preferences.admission();
		const pair = externalFfmpegExecutablePairFromRuntimeAdmission(admission);
		if (!admission || !pair) throw new Error('An authenticated external FFmpeg is required for native source decoding.');
		const assertIdentity = async () => {
			signal.throwIfAborted();
			if (options.preferences.admission() !== admission || !await externalFfmpegExecutablePairMatches(pair,
				path => sha256ExternalFfmpegRegularFile(path, { notRegularFile: () => new Error('The source decoder executable is not regular.') }))
				|| options.preferences.admission() !== admission) {
				await options.preferences.invalidateAdmission(admission, 'identity-changed');
				throw new Error('The authenticated source decoder executable changed.');
			}
		};
		await assertIdentity();
		const path = await options.registry.resolveInputPathForMain(request.jobId, request.source, signal);
		state.directory = await mkdtemp(join(dirname(path), 'native-source-'));
		const inspected = JSON.parse(await captureKeyedVideoProcess({ executablePath: pair.ffprobePath, directory: state.directory,
			signal, maximumBytes: 1024 ** 2, arguments: ['-v', 'error', '-protocol_whitelist', 'file', '-select_streams', 'v:0',
				'-show_entries', 'stream=width,height,r_frame_rate,sample_aspect_ratio:stream_tags=rotate:stream_side_data=rotation,displaymatrix',
				'-of', 'json', path] })) as { streams?: ProbedStream[] };
		const stream = inspected.streams?.[0]; const rate = stream?.r_frame_rate?.split('/').map(Number);
		if (inspected.streams?.length !== 1 || stream?.width !== request.width || stream.height !== request.height
			|| rate?.length !== 2 || !rate.every(value => Number.isSafeInteger(value) && value > 0)
			|| BigInt(rate[0]!) * BigInt(request.frameRate.den) !== BigInt(rate[1]!) * BigInt(request.frameRate.num)) throw new Error('Native source decode changed its exact source geometry or rate.');
		assertUntransformedDisplay(stream);
		const byteLength = request.width * request.height * 4 * request.frameCount;
		const output = join(state.directory, 'source.rgba');
		await captureKeyedVideoProcess({ executablePath: pair.executablePath, directory: state.directory, signal, maximumBytes: 1024,
			arguments: guardExternalFfmpegVideoArguments(['-nostdin', '-y', '-noautorotate', '-i', path, '-map', '0:v:0',
				'-an', '-sn', '-dn', '-frames:v', String(request.frameCount + 1), '-fps_mode', 'passthrough',
				'-c:v', 'rawvideo', '-pix_fmt', 'rgba', '-f', 'rawvideo', output], byteLength + 1) });
		await assertIdentity();
		await options.registry.resolveInputPathForMain(request.jobId, request.source, signal);
		state.file = await open(output, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const stat = await state.file.stat();
		if (!stat.isFile() || stat.nlink !== 1 || stat.size !== byteLength) throw new Error('Native source decode changed its complete RGBA frame inventory.');
		state.byteLength = byteLength;
		return Object.freeze({ contractVersion: 1 as const, jobId: request.jobId, sourceSha256: request.source.sha256,
			width: request.width, height: request.height, frameCount: request.frameCount, byteLength });
	}
	async function cancel(jobId: string): Promise<void> {
		const state = jobs.get(jobId); if (!state) return;
		state.cleanup ??= (async () => {
			state.controller.abort(); await state.completion.catch(() => undefined);
			try { await state.file?.close(); }
			finally { if (state.directory) await rm(state.directory, { recursive: true, force: true }); jobs.delete(jobId); }
		})();
		await state.cleanup;
	}
	return Object.freeze({ async decode(value: unknown) {
		const request = validateKeyingSourceDecodeRequest(value);
		if (disposed || jobs.has(request.jobId)) throw new Error('The native source decode job is closed or already active.');
		options.operations.assertJob(request.jobId);
		const state: DecodeState = { controller: new AbortController(), completion: Promise.resolve() };
		jobs.set(request.jobId, state);
		const task = perform(request, state); state.completion = task;
		try { return await task; } catch (error) { await cancel(request.jobId); throw error; }
	}, async read(value: unknown): Promise<Uint8Array> {
		const record = keyingDecodeRecord(value, ['jobId', 'offset', 'maximumBytes']);
		if (typeof record.jobId !== 'string') throw new TypeError('Invalid native source read job.');
		options.operations.assertJob(record.jobId);
		const state = jobs.get(record.jobId); const offset = Number(record.offset), maximum = Number(record.maximumBytes);
		if (!state?.file || state.controller.signal.aborted || !Number.isSafeInteger(record.offset) || offset < 0
			|| !Number.isSafeInteger(record.maximumBytes) || maximum < 1 || maximum > KEYING_SOURCE_READ_MAXIMUM_BYTES
			|| offset >= state.byteLength!) throw new RangeError('Invalid native source decode range.');
		const length = Math.min(maximum, state.byteLength! - offset); const bytes = new Uint8Array(length);
		let held = 0;
		while (held < length) {
			state.controller.signal.throwIfAborted();
			const result = await state.file.read(bytes, held, length - held, offset + held);
			if (!result.bytesRead) throw new Error('The native source decode file was truncated.');
			held += result.bytesRead;
		}
		return bytes;
	}, cancel, async dispose() { disposed = true; await Promise.all([...jobs.keys()].map(cancel)); } });
}

/** Raw RGBA has no display matrix or sample-aspect metadata for the keyed derivative to retain. */
function assertUntransformedDisplay(stream: ProbedStream): void {
	const aspect = stream.sample_aspect_ratio;
	if (aspect !== undefined && aspect !== 'N/A' && aspect !== '0:1') {
		const terms = /^([1-9]\d*):([1-9]\d*)$/u.exec(aspect);
		if (!terms || BigInt(terms[1]!) !== BigInt(terms[2]!)) {
			throw new Error('Native keying requires square pixels to preserve source display geometry.');
		}
	}
	const sideData = stream.side_data_list ?? [];
	for (const rotation of [stream.tags?.rotate, ...sideData.map(value => value.rotation)]) {
		if (rotation !== undefined && (!Number.isFinite(Number(rotation)) || Number(rotation) % 360 !== 0)) {
			throw new Error('Native keying cannot preserve source display rotation.');
		}
	}
	for (const { displaymatrix } of sideData) {
		if (displaymatrix === undefined) continue;
		const matrix = displaymatrix.trim().split(/\r?\n/u).flatMap(line => line.slice(line.indexOf(':') + 1).trim().split(/\s+/u).map(Number));
		const identity = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
		if (matrix.length !== identity.length || matrix.some((value, index) => value !== identity[index])) {
			throw new Error('Native keying cannot preserve a transformed source display geometry.');
		}
	}
}
