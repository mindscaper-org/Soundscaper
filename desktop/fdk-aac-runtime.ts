/* SPDX-License-Identifier: AGPL-3.0-only */
import { writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { AAC_PACKET_FRAMES, supportsFdkAacGeometry } from './fdk-aac-geometry.ts';
import {
	FDK_AAC_VERSION, fdkAacOutputSize, loadFdkAacIdentity, readFdkAacResult, runFdkAac,
	verifyFdkAacExecutable, verifyFdkPcmFile, withFdkAacScratch,
} from './fdk-aac-process.ts';
import { DesktopCodecOperationQueue } from './desktop-codec-operation-queue.ts';
import type { DesktopAudioStreamJob } from './desktop-audio-stream-service.ts';
import type { DesktopAudioCodecProviderExecutionResult, DesktopAudioCodecProviderRuntime } from './desktop-audio-codec-broker.ts';
import type { DesktopAudioEncodeRequest, DesktopAudioDecodeRequest } from './desktop-audio-codec-operation-contract.ts';
import type { DesktopCodecOperation, DesktopCodecPreflightResult } from '../src/common/editor/desktop-codec-coordinator.ts';

const SUPPORTED = { disposition: 'supported', reason: null } as const;
const UNSUPPORTED = { disposition: 'unsupported', reason: 'The bundled encoder or decoder does not support this AAC configuration.' } as const;
const MAXIMUM_FILE_BYTES = 1_000_000_000;
const JOB_TIMEOUT = 300_000;
type EncodedInput = Readonly<{ sampleRate: number; channelCount: number; bitrateKbps: number; frameCount: number }>;
type Decoded = Extract<DesktopAudioCodecProviderExecutionResult, { status: 'executed' }>;
type AacEncodeRequest = Extract<DesktopAudioEncodeRequest, { format: 'aac-m4a' }>;

export async function loadFdkAacRuntime(options: Readonly<{ desktopRoot: string; runtimeRoot: string; scratchRoot: string; target: string }>) {
	const identity = await loadFdkAacIdentity(options.desktopRoot, options.runtimeRoot, options.target);
	if (identity === null) return null;
	await verifyFdkAacExecutable(identity);
	const admittedIdentity = identity;
	const gate = new DesktopCodecOperationQueue(2);

	const provider = Object.freeze({
		kind: 'bundled' as const, id: 'bundled-fdk-aac', implementation: 'fdk-aac',
		version: FDK_AAC_VERSION, capabilityGeneration: identity.sha256,
		preflight(operation: DesktopCodecOperation): Promise<DesktopCodecPreflightResult> {
			const supported = operation.codec === 'aac' && operation.container === 'm4a' && operation.profile === 'lc'
				&& (operation.direction === 'decode' && operation.sampleRate === null
					|| (operation.direction === 'decode' || operation.direction === 'encode')
						&& supportsFdkAacGeometry(operation.sampleRate ?? 0, operation.channelCount ?? 0));
			return Promise.resolve(supported ? SUPPORTED : UNSUPPORTED);
		},
	});

	async function encodeFile(directory: string, input: string, output: string, geometry: EncodedInput,
		maximumBytes: number, timeout: number, signal?: AbortSignal): Promise<number> {
		const adts = 'encoded.aac';
		const limit = Math.min(maximumBytes, MAXIMUM_FILE_BYTES);
		const delayText = await runFdkAac(admittedIdentity, [
			'encode', String(geometry.sampleRate), String(geometry.channelCount), String(geometry.bitrateKbps * 1000),
			String(limit), input, adts,
		], directory, timeout, signal);
		if (delayText === null || !/^[1-9]\d{0,4}$/u.test(delayText)) throw new Error('The bundled AAC encoder refused the configuration.');
		const delay = Number(delayText);
		if (delay !== 2 * AAC_PACKET_FRAMES) throw new Error('The bundled AAC encoder reported a different priming delay.');
		const path = join(directory, output);
		const { muxFdkAac } = await import('./fdk-aac-container.ts');
		await muxFdkAac(join(directory, adts), path, geometry, geometry.frameCount, delay, limit, signal);
		return await fdkAacOutputSize(path, limit);
	}

	async function encode(request: AacEncodeRequest, signal?: AbortSignal): Promise<Decoded> {
		return await withFdkAacScratch(options.scratchRoot, async (directory) => {
			await writeFile(join(directory, 'input.pcm'), request.input, { flag: 'wx', mode: 0o600, signal });
			await encodeFile(directory, 'input.pcm', 'output.m4a', {
				...request, bitrateKbps: request.settings.bitrateKbps, frameCount: request.input.byteLength / (request.channelCount * 4),
			}, request.maximumOutputBytes, JOB_TIMEOUT, signal);
			return { status: 'executed', output: await readFdkAacResult(join(directory, 'output.m4a'), request.maximumOutputBytes) };
		});
	}

	async function decode(request: DesktopAudioDecodeRequest, signal?: AbortSignal): Promise<Decoded | null> {
		return await withFdkAacScratch(options.scratchRoot, async (directory) => {
			const { writeFdkAdts } = await import('./fdk-aac-container.ts');
			const plan = await writeFdkAdts(request.input, join(directory, 'input.aac'), request.maximumOutputBytes, signal);
			if (!plan) return null;
			const stride = plan.channelCount * 4;
			const expectedBytes = plan.decodedFrames * stride;
			const result = await runFdkAac(admittedIdentity, [
				'decode', String(plan.sampleRate), String(plan.channelCount), String(expectedBytes), 'input.aac', 'output.pcm',
			], directory, JOB_TIMEOUT, signal);
			if (result === null) return null;
			const bytes = await readFdkAacResult(join(directory, 'output.pcm'), expectedBytes);
			if (bytes.byteLength !== expectedBytes) throw new Error('The bundled AAC decoder returned different PCM geometry.');
			const start = plan.leadingFrames * stride;
			return { status: 'executed', output: bytes.slice(start, start + plan.frameCount * stride),
				decodedGeometry: { sampleRate: plan.sampleRate, channelCount: plan.channelCount, frameCount: plan.frameCount } };
		});
	}

	const runtime: DesktopAudioCodecProviderRuntime = {
		provider, measureDecodeOutput: true,
		selectRequestRuntime(request) {
			if (request.operation !== 'audio-decode' || request.format !== 'aac-m4a') return Promise.resolve(null);
			let decoded: Promise<Decoded | null> | undefined;
			const selected: DesktopAudioCodecProviderRuntime = {
				provider,
				async preflightRequest(_request, { signal }) {
					decoded ??= gate.run(() => decode(request, signal), { signal, refused: refusedJob });
					return await decoded === null ? UNSUPPORTED : SUPPORTED;
				},
				async execute() {
					const result = await decoded;
					if (!result) throw new Error('The bundled AAC input was never admitted.');
					return result;
				},
			};
			return Promise.resolve(selected);
		},
		async execute(request, { signal }) {
			if (request.operation !== 'audio-encode' || request.format !== 'aac-m4a') {
				throw new Error('The bundled AAC encoder received an unsupported request.');
			}
			return await gate.run(() => encode(request, signal), { signal, refused: refusedJob });
		},
	};

	return Object.freeze({ runtime, supportsEncode: supportsFdkAacGeometry,
		async encodeStream(job: DesktopAudioStreamJob, signal: AbortSignal) {
			const { tuple, maximumOutputBytes, frameCount } = job.plan;
			if (tuple.format !== 'aac-m4a' || !tuple.settings || !('bitrateKbps' in tuple.settings)
				|| !supportsFdkAacGeometry(tuple.sampleRate, tuple.channelCount)
				|| dirname(job.inputPath) !== dirname(job.outputPath)) throw new Error('Invalid FDK AAC stream request.');
			const bitrateKbps = tuple.settings.bitrateKbps;
			return await gate.run(async () => {
				await verifyFdkPcmFile(job.inputPath, frameCount * tuple.channelCount * 4, job.inputSha256, signal);
				return await encodeFile(dirname(job.inputPath), basename(job.inputPath), basename(job.outputPath),
					{ sampleRate: tuple.sampleRate, channelCount: tuple.channelCount, bitrateKbps, frameCount },
					maximumOutputBytes, 3600_000, signal);
			}, { signal, refused: refusedJob });
		},
	});
}

function refusedJob(reason: 'cancelled' | 'busy'): never {
	throw new Error(reason === 'busy' ? 'The bundled AAC codec queue is full.' : 'The bundled AAC codec job was cancelled.');
}
