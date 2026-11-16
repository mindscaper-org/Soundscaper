/* SPDX-License-Identifier: AGPL-3.0-only */
import { BASIC_PITCH_INPUT_SAMPLES, BASIC_PITCH_OUTPUT_FRAMES, BASIC_PITCH_BORDER_FRAMES,
	BASIC_PITCH_RETAINED_FRAMES, BASIC_PITCH_WINDOW_STEP, decodeBasicPitchNotes } from '../src/common/editor/assistance/basic-pitch-notes.ts';
import { MUSIC_TRANSCRIPTION_MAXIMUM_SAMPLES } from '../src/common/editor/assistance/music-transcription-v1.ts';
import { BASIC_PITCH_MODEL_ID, BASIC_PITCH_MODEL_VERSION } from '../src/common/editor/assistance/basic-pitch-model.ts';
import { openAssistanceFloat32MonoWaveFileV1 } from './assistance-float32-mono-wave-file-reader.ts';
import { assertAssistanceOnnxJobV1, createAssistanceOnnxSessionV1,
	publishAssistanceOnnxOutputV1, reviewAssistanceOnnxRuntimeModuleV1 } from './assistance-onnx-worker-common.ts';
import type { AssistanceOnnxRuntimeModuleV1, AssistanceOnnxTensorV1 } from './assistance-onnx-runtime-worker.ts';
import type { AssistanceRuntimeFamilyWorkerExecutionContext } from './assistance-runtime-family-worker-entry.ts';

const INPUT = 'serving_default_input_2:0';
const NOTES = 'StatefulPartitionedCall:1', ONSETS = 'StatefulPartitionedCall:2', CONTOURS = 'StatefulPartitionedCall:0';
type Loader = (path: string) => PromiseLike<AssistanceOnnxRuntimeModuleV1>;
const errors = Object.freeze({ value: 'Invalid Basic Pitch runtime.', surface: 'Invalid Basic Pitch runtime surface.' });

/** The loader is the owning ONNX worker's authenticated GPU/fallback adapter. */
export function createAssistanceBasicPitchWorkerAdapterV1(loadRuntime: Loader) {
	return async (context: AssistanceRuntimeFamilyWorkerExecutionContext): Promise<unknown> => {
		assertAssistanceOnnxJobV1(context, 'music-transcription', 'Invalid Basic Pitch runtime job.');
		const { grant, settings, signal } = context;
		const model = grant.models[0], input = grant.inputs[0], output = grant.outputs[0];
		if (grant.models.length !== 1 || model?.modelId !== BASIC_PITCH_MODEL_ID || model.version !== BASIC_PITCH_MODEL_VERSION || model.artifactRole !== 'nmp'
			|| grant.inputs.length !== 1 || input?.role !== 'audio' || input.mediaType !== 'audio/wav'
			|| grant.outputs.length !== 1 || output?.role !== 'midi-notes' || output.mediaType !== 'application/vnd.soundscaper.midi-notes+json'
			|| settings.schemaVersion !== 1 || settings.operation !== 'music-transcription'
			|| JSON.stringify(settings.inputRoles) !== '["audio"]' || JSON.stringify(settings.outputRoles) !== '["midi-notes"]') {
			throw new TypeError('Basic Pitch requires exact audio, model and MIDI note output grants.');
		}
		signal?.throwIfAborted(); context.onProgress(0);
		const wave = await openAssistanceFloat32MonoWaveFileV1(input.path, 22_050, input.byteLength);
		try {
			if (wave.sampleCount > MUSIC_TRANSCRIPTION_MAXIMUM_SAMPLES) throw new RangeError('Transcribe at most 30 minutes of music per selection.');
			const module = reviewAssistanceOnnxRuntimeModuleV1(await loadRuntime(context.job.descriptor.entrypoint), errors);
			const session = await createAssistanceOnnxSessionV1(module, model.path, errors);
			try {
				if (JSON.stringify(session.inputNames) !== JSON.stringify([INPUT])
					|| JSON.stringify([...session.outputNames].sort()) !== JSON.stringify([NOTES, ONSETS, CONTOURS].sort())) throw new TypeError('Invalid Basic Pitch graph signature.');
				const windowCount = Math.ceil((wave.sampleCount + BASIC_PITCH_BORDER_FRAMES * 256) / BASIC_PITCH_WINDOW_STEP);
				const frameCount = windowCount * BASIC_PITCH_RETAINED_FRAMES;
				const frames = new Float32Array(frameCount * 88), onsets = new Float32Array(frameCount * 88);
				for (let window = 0; window < windowCount; window++) {
					signal?.throwIfAborted();
					const start = window * BASIC_PITCH_WINDOW_STEP - BASIC_PITCH_BORDER_FRAMES * 256;
					const first = Math.max(0, start), last = Math.min(wave.sampleCount, start + BASIC_PITCH_INPUT_SAMPLES);
					const pcm = new Float32Array(BASIC_PITCH_INPUT_SAMPLES);
					if (last > first) pcm.set(await wave.readSamples(first, last - first, signal), first - start);
					const result = await session.run({ [INPUT]: new module.Tensor('float32', pcm, [1, BASIC_PITCH_INPUT_SAMPLES, 1]) });
					if (JSON.stringify(Object.keys(result).sort()) !== JSON.stringify([NOTES, ONSETS, CONTOURS].sort())) throw new TypeError('Invalid Basic Pitch output tensor inventory.');
					const note = probabilityTensor(result[NOTES], 88), onset = probabilityTensor(result[ONSETS], 88);
					probabilityTensor(result[CONTOURS], 264);
					const left = BASIC_PITCH_BORDER_FRAMES * 88, right = (BASIC_PITCH_OUTPUT_FRAMES - BASIC_PITCH_BORDER_FRAMES) * 88;
					frames.set(note.subarray(left, right), window * BASIC_PITCH_RETAINED_FRAMES * 88);
					onsets.set(onset.subarray(left, right), window * BASIC_PITCH_RETAINED_FRAMES * 88);
					context.onProgress((window + 1) / (windowCount + 1));
				}
				const result = decodeBasicPitchNotes({ frames, onsets, frameCount, sampleCount: wave.sampleCount }, signal);
				return await publishAssistanceOnnxOutputV1(context, () => Buffer.from(JSON.stringify(result)), 'Basic Pitch output exceeds its reservation.');
			} finally { await session.release?.(); }
		} finally { await wave.close(); }
	};
}

function probabilityTensor(value: AssistanceOnnxTensorV1 | undefined, bins: number): Float32Array {
	if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)
		|| JSON.stringify(value.dims) !== JSON.stringify([1, BASIC_PITCH_OUTPUT_FRAMES, bins])
		|| value.data.length !== BASIC_PITCH_OUTPUT_FRAMES * bins) throw new TypeError('Invalid Basic Pitch tensor geometry.');
	for (const probability of value.data) if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new TypeError('Invalid Basic Pitch tensor probability.');
	return value.data;
}
