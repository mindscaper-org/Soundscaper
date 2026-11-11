/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded, channel-preserving enhancement in the authenticated Sherpa worker. */
import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import { createWavHeader } from '../src/common/editor/wav.js';
import { speechEnhancementModel } from '../src/common/editor/assistance/speech-enhancement-models.ts';
import { authenticateSherpaEnhancementGrant } from './assistance-sherpa-enhancement-capture.ts';
import { validateSherpaEnhancementGrant, type SherpaEnhancementGrant,
	type SherpaEnhancementResult } from './assistance-sherpa-enhancement-contract.ts';
import { callSherpaNativeV1, createSherpaNativeExecutorV1,
	type SherpaAccelerationOptions } from './assistance-sherpa-acceleration.ts';
import { nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';
import { createNodeAssistanceFloat32WaveStorageV1, type AssistanceFloat32WaveSourceV1,
	type AssistanceFloat32WaveSinkV1 } from './assistance-streaming-float32-wave.ts';
import type { AssistanceRuntimeFamilyOutputGrantV1 } from './assistance-runtime-family-job-contract.ts';

const RATE = 48_000, CHUNK = 7_680;
interface Audio { readonly samples: Float32Array; readonly sampleRate: number; }
interface Denoiser {
	readonly sampleRate: number;
	run(request: { samples: Float32Array; sampleRate: number; enableExternalBuffer: false }): Audio;
	flush(enableExternalBuffer: false): Audio;
}
interface Module { readonly OnlineSpeechDenoiser: new (config: unknown) => Denoiser; }
interface Options extends SherpaAccelerationOptions {
	readonly authenticateGrant?: typeof authenticateSherpaEnhancementGrant;
	readonly disposeNativeResources?: () => void;
	readonly onProgress?: (value: number) => void;
}

export async function executeSherpaEnhancement(value: unknown, runtime: unknown,
	options: Options = {},
): Promise<SherpaEnhancementResult> {
	const grant = validateSherpaEnhancementGrant(value);
	await (options.authenticateGrant ?? authenticateSherpaEnhancementGrant)(grant);
	const namespace = runtime as Partial<Module> & { default?: Partial<Module> };
	const module = typeof namespace.OnlineSpeechDenoiser === 'function' ? namespace : namespace.default ?? {};
	if (typeof module.OnlineSpeechDenoiser !== 'function') throw new TypeError('Sherpa lacks the streaming denoiser.');
	const storage = createNodeAssistanceFloat32WaveStorageV1();
	const executor = createSherpaNativeExecutorV1(options);
	let progress = 0;
	const source = await storage.openSource(grant.input, RATE);
	// Main removes the entire job tree after forced worker cancellation as well.
	const directory = await mkdtemp(join(dirname(grant.output.path), '.enhancement-'));
	const channelSources: AssistanceFloat32WaveSourceV1[] = [];
	let output: AssistanceFloat32WaveSinkV1 | undefined;
	try {
		const voiceSample = grant.modelId === 'voxlock' ? await voiceReference(source, directory) : undefined;
		for (let channel = 0; channel < source.geometry.channelCount; channel += 1) {
			const channelOutput = await temporaryOutput(grant.output, join(directory, `channel-${channel}.wav`));
			const geometry = { ...source.geometry, channelCount: 1, byteLength: 44 + source.geometry.frameCount * 4 };
			const sealed = await executor.run(undefined, async (provider) => {
				const sink = await storage.openSink(channelOutput, geometry);
				try {
					const model = modelConfig(grant, options.providerForModel?.(grant.modelId, provider) ?? provider, voiceSample);
					const denoiser = callSherpaNativeV1(() => new module.OnlineSpeechDenoiser!({ model }));
					const expectedRate = speechEnhancementModel(grant.modelId)!.sampleRate;
					if (denoiser.sampleRate !== expectedRate) throw new RangeError('The denoiser sample rate differs from its reviewed model.');
					const resampler = createStreamingWindowedSincResampler(expectedRate, RATE, 1);
					let written = 0, generated = 0;
					const write = async (audio: Audio): Promise<void> => {
						if (audio.sampleRate !== expectedRate || !(audio.samples instanceof Float32Array)
							|| audio.samples.some((sample) => !Number.isFinite(sample))) throw new TypeError('The denoiser returned invalid audio.');
						generated += audio.samples.length;
						const samples = resampler.push([audio.samples])[0]!;
						const frames = Math.min(samples.length, geometry.frameCount - written);
						if (frames > 0) { await sink.writeFrames([samples.subarray(0, frames)]); written += frames; }
					};
					for (let start = 0; start < geometry.frameCount; start += CHUNK) {
						const samples = (await source.readFrames({ startFrame: start,
							frameCount: Math.min(CHUNK, geometry.frameCount - start), channelStart: channel, channelCount: 1 }))[0]!;
						await write(callSherpaNativeV1(() => denoiser.run({ samples, sampleRate: RATE, enableExternalBuffer: false })));
						progress = Math.max(progress, (channel + Math.min(1, (start + CHUNK) / geometry.frameCount)) / source.geometry.channelCount);
						options.onProgress?.(progress);
					}
					await write(callSherpaNativeV1(() => denoiser.flush(false)));
					// Upstream flush pads the final hop. Only that bounded tail can differ.
					if (Math.abs(generated - Math.round(geometry.frameCount * expectedRate / RATE)) > expectedRate / 10) {
						throw new RangeError('The denoiser changed the selected duration.');
					}
					const tail = resampler.finish(geometry.frameCount)[0]!;
					const remaining = geometry.frameCount - written;
					if (remaining > 0) await sink.writeFrames([tail.subarray(0, remaining)]);
					const result = await sink.seal(); await sink.publish(); await sink.commit(); return result;
				} catch (error) { await sink.rollback(); throw error; }
				finally { options.disposeNativeResources?.(); }
			});
			channelSources.push(await storage.openSource({ claimId: grant.input.claimId, role: 'audio', mediaType: 'audio/wav',
				path: channelOutput.path, ...sealed, identity: nativeChildFileIdentityFromStat(await lstat(channelOutput.path, { bigint: true })) }, RATE));
		}
		output = await storage.openSink(grant.output, source.geometry);
		for (let start = 0; start < source.geometry.frameCount; start += CHUNK) {
			const channels: Float32Array[] = [];
			for (const channel of channelSources) channels.push((await channel.readFrames({ startFrame: start,
				frameCount: Math.min(CHUNK, source.geometry.frameCount - start), channelStart: 0, channelCount: 1 }))[0]!);
			await output.writeFrames(channels);
		}
		const result = await output.seal(); await output.publish(); await output.commit(); return result;
	} catch (error) { await output?.rollback(); throw error; }
	finally {
		await source.close(); await Promise.all(channelSources.map((channel) => channel.close()));
		await rm(directory, { recursive: true, force: true });
	}
}

async function temporaryOutput(base: AssistanceRuntimeFamilyOutputGrantV1, path: string) {
	await writeFile(path, '', { flag: 'wx', mode: 0o600 });
	return { ...base, path, identity: nativeChildFileIdentityFromStat(await lstat(path, { bigint: true })) };
}

function modelConfig(grant: SherpaEnhancementGrant, provider: string, voiceSample?: string) {
	const paths = Object.fromEntries(grant.models.map((model) => [model.artifactRole, model.path]));
	return { numThreads: 2, debug: 0, provider,
		...(grant.modelId === 'gtcrn' ? { gtcrn: { model: paths.gtcrn_simple } }
			: grant.modelId === 'dpdfnet2-48khz' ? { dpdfnet: { model: paths.dpdfnet2_48khz_hr } }
				: { voxlock: { enrollModel: paths.voxlock_enroll, chunkModel: paths.voxlock_chunk_int8, voiceSample } }) };
}

/** One shared voice for every channel, chosen from the loudest three-second window. */
async function voiceReference(source: AssistanceFloat32WaveSourceV1, directory: string): Promise<string> {
	const frames = Math.min(source.geometry.frameCount, 15 * RATE), window = 3 * RATE, hop = RATE / 100;
	if (frames < window) throw new RangeError('VoxLock needs at least three seconds of selected audio.');
	let bestEnergy = -1, reference: Float32Array | undefined;
	for (let channel = 0; channel < source.geometry.channelCount; channel += 1) {
		const values = (await source.readFrames({ startFrame: 0, frameCount: frames, channelStart: channel, channelCount: 1 }))[0]!;
		let energy = 0;
		for (let index = 0; index < window; index += 1) energy += values[index]! ** 2;
		for (let start = 0; start <= frames - window; start += hop) {
			if (start > 0) for (let index = start - hop; index < start; index += 1) {
				energy += values[index + window]! ** 2 - values[index]! ** 2;
			}
			if (energy > bestEnergy) { bestEnergy = energy; reference = values.slice(start, start + window); }
		}
	}
	if (!reference || bestEnergy <= 0) throw new RangeError('VoxLock needs an audible voice reference.');
	const path = join(directory, 'voice.wav');
	const header = createWavHeader({ sampleRate: RATE, channelCount: 1, totalFrames: window, bitDepth: 32, float: true });
	await writeFile(path, Buffer.concat([Buffer.from(header), Buffer.from(reference.buffer)]), { flag: 'wx', mode: 0o600 });
	return path;
}
