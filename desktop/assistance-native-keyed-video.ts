/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { nativeRgbaFramePackV1ByteLength } from '../src/common/editor/native-rgba-frame-pack-v1-contract.ts';
import { assistanceNativeKeyedPlan } from './assistance-native-keyed-video-plan.ts';
import { inspectKeyedVideoProbe, type AssistanceKeyedVideoRequest } from './assistance-keyed-video-contract.ts';
import { openAssistanceKeyedVideoFrames } from './assistance-keyed-video-frames.ts';
import { describeFramescaperMediaHostAvailability, type FramescaperMediaHostPayloadLocation } from './framescaper-media-host-payload.ts';
import { createIsolatedNativeMediaHostProcessInvoker } from './native-media-isolated-host-process.ts';
import { parseNativeMediaHostControl } from './native-media-host-result.ts';
import type { createAssistanceOperationService } from './assistance-operation-service.ts';
import type { AssistanceStagingRegistry } from './assistance-staging-registry.ts';
import type { HelperDataPlaneByteSink } from './helper-data-plane-io.ts';

interface Options {
	readonly location: FramescaperMediaHostPayloadLocation;
	readonly operations: Pick<ReturnType<typeof createAssistanceOperationService>, 'assertJob' | 'openOutput'>;
	readonly registry: Pick<AssistanceStagingRegistry, 'reserveOutput' | 'resolveOutputReservationPathForMain' | 'authenticateOutput'>;
}

/** Main-owned bridge: original claims remain authoritative and all codec work stays isolated. */
export function createAssistanceNativeKeyedVideoEncoder(options: Options) {
	const descriptor = async () => {
		const result = await describeFramescaperMediaHostAvailability(options.location);
		if (result.status === 'available') return result.descriptor;
		if (result.reason === 'payload-digest-mismatch' || result.reason === 'manifest-unreadable') {
			throw new Error(`The bundled keying encoder failed authentication: ${result.detail}`);
		}
		return null;
	};
	return Object.freeze({
		async available(request?: AssistanceKeyedVideoRequest, signal = new AbortController().signal): Promise<boolean> {
			if (await descriptor() === null) return false;
			if (!request) return true;
			const frames = await openAssistanceKeyedVideoFrames(request.outputs,
				(claim) => options.operations.openOutput({ jobId: request.jobId, claim }), request.frameRate, signal);
			try { assistanceNativeKeyedPlan(request.jobId, frames); return true; }
			catch (error) { if (error instanceof RangeError) return false; throw error; }
			finally { await frames.close(); }
		},
		async encode(request: AssistanceKeyedVideoRequest, signal: AbortSignal) {
			options.operations.assertJob(request.jobId);
			signal.throwIfAborted();
			const host = await descriptor();
			if (!host) throw new Error('The bundled VP9 alpha encoder is unavailable.');
			const frames = await openAssistanceKeyedVideoFrames(request.outputs,
				(claim) => options.operations.openOutput({ jobId: request.jobId, claim }), request.frameRate, signal);
			let scratch: string | null = null;
			let child: ReturnType<ReturnType<typeof createIsolatedNativeMediaHostProcessInvoker>> | null = null;
			const abort = (): void => { if (child) void child.cancel().catch(() => {}); };
			try {
				const plan = Buffer.from(JSON.stringify(assistanceNativeKeyedPlan(request.jobId, frames)));
				const maximumByteLength = Math.min(8 * 1024 ** 3,
					frames.width * frames.height * 4 * frames.frameCount + 16 * 1024 ** 2);
				const reservation = await options.registry.reserveOutput({ jobId: request.jobId,
					role: 'keyed-video', mediaType: 'video/webm', maximumByteLength });
				const path = await options.registry.resolveOutputReservationPathForMain(request.jobId, reservation, signal);
				scratch = await mkdtemp(join(dirname(path), 'native-keyed-'));
				const planPath = join(scratch, 'plan.json');
				await writeFile(planPath, plan, { flag: 'wx', mode: 0o600 });
				const byteLength = nativeRgbaFramePackV1ByteLength(frames);
				child = createIsolatedNativeMediaHostProcessInvoker(host)({
					executablePath: host.path, operation: 'media-encode', plan: { path: planPath, sha256: digest(plan) },
					sources: [{ path: null, sha256: null, byteLength, role: 'evaluated-rgba-frame-pack',
						liveInput: { transport: 'native-pipe', byteLength } }], videoTimingAssets: [],
					backend: 'native-cpu', maximumOutputBytes: maximumByteLength, scratchPath: scratch,
					decodeOutputPath: null, destinationRoot: dirname(path), temporaryOutputPath: path,
					proxyRecipe: null, imageSequence: null,
				});
				void child.completion.catch(() => {});
				signal.addEventListener('abort', abort, { once: true });
				signal.throwIfAborted();
				const sink = child.inputs?.[0]?.sink;
				if (!sink) throw new Error('The native alpha encoder has no authenticated input pipe.');
				await writeFrames(sink, frames, signal);
				const result = await child.completion;
				signal.throwIfAborted();
				if (result.exitCode !== 0) throw new Error(`The native VP9 alpha encoder failed: ${result.stdout}`);
				const control = parseNativeMediaHostControl('media-encode', result.stdout);
				if (!('sha256' in control) || !('byteLength' in control)) throw new Error('The native alpha encoder returned no output identity.');
				const reportPath = join(scratch, 'keyed-video-inspection.json');
				const stat = await lstat(reportPath);
				if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 ** 2) {
					throw new Error('The native alpha verification report is invalid.');
				}
				const report = JSON.parse(String(await readFile(reportPath))) as Readonly<{ outputSha256?: unknown; probe?: unknown }>;
				if (report.outputSha256 !== control.sha256) throw new Error('The native alpha report lost its output identity.');
				const inspection = inspectKeyedVideoProbe(report.probe, frames);
				const claim = await options.registry.authenticateOutput(request.jobId, reservation, signal);
				if (claim.sha256 !== control.sha256 || claim.byteLength !== control.byteLength) {
					throw new Error('The native keyed video changed after verification.');
				}
				return Object.freeze({ contractVersion: 1 as const, jobId: request.jobId, sourceId: request.sourceId,
					claim, inspection: Object.freeze({ ...inspection, sha256: claim.sha256 }) });
			} catch (error) { if (child) await child.cancel(); throw error; }
			finally {
				signal.removeEventListener('abort', abort);
				try { await frames.close(); }
				finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
			}
		},
	});
}

async function writeFrames(sink: HelperDataPlaneByteSink,
	frames: Awaited<ReturnType<typeof openAssistanceKeyedVideoFrames>>, signal: AbortSignal): Promise<void> {
	const magic = Buffer.from('framescaper-rgba-frame-pack-v1\n');
	const header = Buffer.alloc(magic.length + 28); magic.copy(header);
	const offset = magic.length;
	header.writeUInt32LE(1, offset); header.writeUInt32LE(frames.width, offset + 4);
	header.writeUInt32LE(frames.height, offset + 8); header.writeBigUInt64LE(BigInt(frames.frameCount), offset + 12);
	header.writeUInt32LE(frames.frameRate.den, offset + 20); header.writeUInt32LE(frames.frameRate.num, offset + 24);
	await sink.write(header);
	let ordinal = 0;
	await frames.consume(async (rgba) => {
		signal.throwIfAborted();
		const record = Buffer.alloc(32);
		record.writeBigUInt64LE(BigInt(ordinal), 0); record.writeBigInt64LE(BigInt(ordinal), 8);
		record.writeBigInt64LE(1n, 16); record.writeBigUInt64LE(BigInt(rgba.byteLength), 24);
		await sink.write(record);
		for (let position = 0; position < rgba.byteLength; position += 1024 * 1024) {
			signal.throwIfAborted(); await sink.write(rgba.subarray(position, position + 1024 * 1024));
		}
		++ordinal;
	});
	await sink.complete();
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
