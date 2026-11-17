/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';

import { VOICEFIXER_MODEL_ID, VOICEFIXER_MODEL_VERSION, VOICEFIXER_SAMPLE_RATE,
	VOICEFIXER_CHUNK_FRAMES, VOICEFIXER_HOP_FRAMES, VOICEFIXER_MEL_DIMS,
	VOICEFIXER_VOCODER_FRAMES } from '../src/common/editor/assistance/voicefixer-model.ts';
import { createVoiceFixerSignalV1, parseVoiceFixerMelFiltersV1 } from '../src/common/editor/assistance/voicefixer-signal-v1.ts';
import type { AssistanceOnnxRuntimeModuleV1, AssistanceOnnxTensorV1, AssistanceOnnxInferenceSessionV1 } from './assistance-onnx-runtime-worker.ts';
import { assertAssistanceOnnxJobV1, createAssistanceOnnxSessionV1,
	reviewAssistanceOnnxRuntimeModuleV1 } from './assistance-onnx-worker-common.ts';
import type { AssistanceRuntimeFamilyWorkerExecutionContext } from './assistance-runtime-family-worker-entry.ts';
import type { AssistanceRuntimeFamilyJobResultV1 } from './assistance-runtime-family-job-contract.ts';
import { createNodeAssistanceFloat32WaveStorageV1, type AssistanceFloat32WaveSinkV1,
	type AssistanceFloat32WaveStorageV1 } from './assistance-streaming-float32-wave.ts';
import { prepareAssistanceWaveChannelGroup } from './assistance-wave-channel-group-reader.ts';

type Loader = (entrypoint: string) => PromiseLike<AssistanceOnnxRuntimeModuleV1>;
const ERRORS = Object.freeze({ value: 'The VoiceFixer ONNX runtime is invalid.',
	surface: 'The VoiceFixer ONNX runtime surface is invalid.' });
const ROLES = ['analysis', 'vocoder', 'mel_filters'] as const;
const SIGNATURES = [ [['mel_orig'], ['mel']], [['mel'], ['wav']] ] as const;

/** Authenticated VoiceFixer analysis/vocoder inference with bounded per-channel overlap. */
export function createAssistanceOnnxVoiceFixerWorkerAdapterV1(
	loadRuntime: Loader,
	waveStorage: AssistanceFloat32WaveStorageV1 = createNodeAssistanceFloat32WaveStorageV1(),
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<AssistanceRuntimeFamilyJobResultV1> {
	return async context => {
		assertAssistanceOnnxJobV1(context, 'speech-enhancement', 'VoiceFixer requires an authenticated ONNX enhancement job.');
		const { grant, settings, signal } = context;
		const input = grant.inputs[0], output = grant.outputs[0];
		if (grant.models.length !== 3 || grant.models.some(model => model.modelId !== VOICEFIXER_MODEL_ID
			|| model.version !== VOICEFIXER_MODEL_VERSION)
			|| ROLES.some(role => grant.models.filter(model => model.artifactRole === role).length !== 1)) {
			throw new TypeError('VoiceFixer requires its exact 1.0.0 analysis, vocoder, and mel filter artifacts.');
		}
		if (settings.schemaVersion !== 1 || settings.operation !== 'speech-enhancement'
			|| JSON.stringify(settings.inputRoles) !== '["audio"]'
			|| JSON.stringify(settings.outputRoles) !== '["enhanced-audio"]'
			|| grant.inputs.length !== 1 || input?.role !== 'audio' || input.mediaType !== 'audio/wav'
			|| grant.outputs.length !== 1 || output?.role !== 'enhanced-audio' || output.mediaType !== 'audio/wav') {
			throw new TypeError('VoiceFixer requires one audio WAV input and enhanced WAV output.');
		}
		signal?.throwIfAborted(); context.onProgress(0);
		const source = await waveStorage.openSource(input, VOICEFIXER_SAMPLE_RATE, signal);
		let sink: AssistanceFloat32WaveSinkV1 | null = null;
		let committed = false;
		try {
			if (source.geometry.channelCount > 32) throw new RangeError('VoiceFixer supports at most 32 channels per selection.');
			sink = await waveStorage.openSink(output, source.geometry, signal);
			const signalLayer = createVoiceFixerSignalV1(parseVoiceFixerMelFiltersV1(
				await readFile(grant.models.find(model => model.artifactRole === 'mel_filters')!.path)));
			const runtime = reviewAssistanceOnnxRuntimeModuleV1(await loadRuntime(context.job.descriptor.entrypoint), ERRORS);
			const sessions: AssistanceOnnxInferenceSessionV1[] = [];
			try {
				for (const [index, role] of ['analysis', 'vocoder'].entries()) {
					signal?.throwIfAborted();
					const session = await createAssistanceOnnxSessionV1(runtime,
						grant.models.find(model => model.artifactRole === role)!.path, ERRORS);
					sessions.push(session);
					if (JSON.stringify([session.inputNames, session.outputNames]) !== JSON.stringify(SIGNATURES[index])) {
						throw new TypeError('The VoiceFixer graph signature is invalid.');
					}
				}
				const { frameCount, channelCount } = source.geometry;
				const tails = Array.from({ length: channelCount }, () => new Float32Array(VOICEFIXER_HOP_FRAMES));
				const workUnits = (Math.ceil(frameCount / VOICEFIXER_HOP_FRAMES) + 1) * channelCount;
				let completed = 0;
				for (let start = -VOICEFIXER_HOP_FRAMES; start < frameCount; start += VOICEFIXER_HOP_FRAMES) {
					signal?.throwIfAborted();
					const window = reflectedWindow(start, frameCount);
					const grouped = prepareAssistanceWaveChannelGroup(source);
					const outputPlanes: Float32Array[] = [];
					const emitted = Math.min(VOICEFIXER_HOP_FRAMES, frameCount - start);
					for (let channel = 0; channel < channelCount; channel += 1) {
						signal?.throwIfAborted();
						const planes = await grouped.readFrames({ startFrame: window.first,
							frameCount: window.last - window.first + 1, channelStart: channel, channelCount: 1 }, signal);
						const waveform = Float32Array.from(window.indices, index => planes[0]![index - window.first]!);
						const restored = await inferWaveform(runtime, sessions, signalLayer, waveform, signal);
						signal?.throwIfAborted();
						const previous = tails[channel]!;
						const plane = new Float32Array(start < 0 ? 0 : emitted);
						for (let frame = 0; frame < VOICEFIXER_HOP_FRAMES; frame += 1) {
							const weight = (frame + 0.5) / VOICEFIXER_HOP_FRAMES;
							if (frame < plane.length) plane[frame] = previous[frame]! + restored[frame]! * weight;
							previous[frame] = restored[VOICEFIXER_HOP_FRAMES + frame]! * (1 - weight);
						}
						outputPlanes.push(plane); completed += 1;
						context.onProgress(completed / (workUnits + 1));
					}
					if (start >= 0) await sink.writeFrames(outputPlanes, signal);
				}
			} finally { await Promise.all(sessions.map(async session => { await session.release?.(); })); }
			await source.close();
			const sealed = await sink.seal(signal);
			signal?.throwIfAborted();
			await sink.publish(signal);
			signal?.throwIfAborted();
			await sink.commit(); committed = true; context.onProgress(1);
			return Object.freeze({ resultVersion: 1, jobId: grant.jobId, familyId: grant.familyId, task: grant.task,
				outputs: Object.freeze([Object.freeze({ claimId: output.claimId, role: output.role,
					mediaType: output.mediaType, byteLength: sealed.byteLength, sha256: sealed.sha256 })]) });
		} finally {
			await source.close().catch(() => undefined);
			if (!committed && sink) await sink.rollback().catch(() => undefined);
		}
	};
}

/** Reflect without repeating edge samples, including selections shorter than one model window. */
function reflectedWindow(start: number, frames: number) {
	let first = frames - 1, last = 0;
	const period = 2 * (frames - 1);
	const indices = Int32Array.from({ length: VOICEFIXER_CHUNK_FRAMES }, (_, offset) => {
		const wrapped = frames === 1 ? 0 : ((start + offset) % period + period) % period;
		const index = wrapped < frames ? wrapped : period - wrapped;
		first = Math.min(first, index); last = Math.max(last, index); return index;
	});
	return { first, last, indices };
}

async function inferWaveform(runtime: AssistanceOnnxRuntimeModuleV1,
	sessions: readonly AssistanceOnnxInferenceSessionV1[], signalLayer: ReturnType<typeof createVoiceFixerSignalV1>,
	waveform: Float32Array, signal?: AbortSignal) {
	const mel = reviewedTensor(await sessions[0]!.run({ mel_orig: new runtime.Tensor('float32',
		signalLayer.analyze(waveform, signal), VOICEFIXER_MEL_DIMS) }), 'mel', VOICEFIXER_MEL_DIMS).data as Float32Array;
	signal?.throwIfAborted();
	const decompressed = mel.map(value => 10 ** Math.min(value, 5));
	const output = reviewedTensor(await sessions[1]!.run({ mel: new runtime.Tensor('float32',
		decompressed, VOICEFIXER_MEL_DIMS) }), 'wav', [1, 1, VOICEFIXER_VOCODER_FRAMES]);
	signal?.throwIfAborted();
	return signalLayer.synthesize(output.data as Float32Array, signal);
}

function reviewedTensor(result: Readonly<Record<string, AssistanceOnnxTensorV1>>, name: string,
	dims: readonly number[]): AssistanceOnnxTensorV1 {
	const value = result[name];
	if (JSON.stringify(Object.keys(result)) !== JSON.stringify([name]) || !value
		|| value.type !== 'float32' || !(value.data instanceof Float32Array)
		|| JSON.stringify(value.dims) !== JSON.stringify(dims)
		|| value.data.length !== dims.reduce((product, size) => product * size, 1) || !value.data.every(Number.isFinite)) {
		throw new TypeError('The VoiceFixer output must be finite with the exact graph geometry.');
	}
	return value;
}
