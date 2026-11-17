/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Incremental adapters to the pinned Audacity 3.7.7 DSP. The attribution and
 * notices in audacity-effects/realtime.js and THIRD_PARTY_LICENSES.md apply.
 */
import { createAudacityLiveProcessor } from '../audacity-effects/live.js';
import { AutoDuckLiveProcessor } from '../audacity-effects/live-dynamics-processors.js';
import { validateNoiseProfile } from '../audacity-effects/spectral-noise-reduction.js';
import { classicFilterCoefficients } from '../audacity-effects/classic-filter-coefficients.js';
import { createStandardEffectProcessor, type StandardEffectProcessor } from '../first-party-effects/standard/dsp.ts';
import { isStandardEffect } from '../first-party-effects/standard/definition.ts';
import { createOfflineNoiseGateProcessor } from '../first-party-effects/standard/noise-gate-dsp.ts';
import { createBitcrusherProcessor } from '../first-party-effects/bitcrusher/dsp.js';
import { createDeesserProcessor } from '../first-party-effects/deesser/dsp.ts';
import { createMultibandCompressorProcessor } from '../first-party-effects/multiband-compressor/dsp.ts';
import { ParametricEqWasmRuntime, PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE } from '../parametric-eq/wasm-runtime.js';

export interface StreamedKernel { readonly latencyFrames?: number; process(input: Float32Array[], output: Float32Array[], control?: Float32Array[]): void; dispose?(): void; finish?(): void }
export function createStreamedKernel(type: string, params: Readonly<Record<string, unknown>>, sampleRate: number, channelCount: number,
	wasmModule?: WebAssembly.Module, frameCount = 0, context?: Readonly<Record<string, unknown>> | null): StreamedKernel {
	if (type === 'audacity-fade-in' || type === 'audacity-fade-out') {
		let offset = 0;
		return { process(input, output) { input.forEach((channel, c) => { for (let frame = 0; frame < channel.length; frame++) {
			output[c]![frame] = channel[frame]! * (type === 'audacity-fade-in' ? offset + frame : frameCount - 1 - offset - frame) / frameCount;
		} }); offset += input[0]!.length; } };
	}
	if (type === 'eq') {
		if (!wasmModule) throw new TypeError('Streamed EQ requires its compiled WASM module.');
		const runtime = new ParametricEqWasmRuntime(wasmModule, { sampleRate, channelCount });
		runtime.configure(params, { mode: 'immediate' });
		return { process(input, output) { for (let offset = 0; offset < input[0]!.length; offset += PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE) {
			const end = Math.min(input[0]!.length, offset + PARAMETRIC_EQ_WASM_MAXIMUM_BLOCK_SIZE);
			runtime.process(input.map(channel => channel.subarray(offset, end)), output.map(channel => channel.subarray(offset, end)));
		} } };
	}
	if (type === 'audacity-classic-filters') return classic(params, sampleRate, channelCount);
	if (type === 'audacity-echo') return echo(params, sampleRate, channelCount);
	if (type.startsWith('audacity-')) {
		if (type === 'audacity-noise-reduction') validateNoiseProfile(context?.noiseProfile, sampleRate);
		const processor = createAudacityLiveProcessor(type, sampleRate, params, { noiseProfile: context?.noiseProfile });
		return { latencyFrames: processor.latencyFrames, finish: () => { if ('finishSelection' in processor && typeof processor.finishSelection === 'function') processor.finishSelection(); }, process: (input, output, control) => { if (processor instanceof AutoDuckLiveProcessor) processor.process(input, output, control); else processor.process(input, output); } };
	}
	const options = { sampleRate, channelCount, params };
	let processor: Pick<StandardEffectProcessor, 'processBlock' | 'latencyFrames' | 'dispose'>;
	if (type === 'bitcrusher') processor = createBitcrusherProcessor(options);
	else if (type === 'deesser') processor = createDeesserProcessor(options);
	else if (type === 'multiband-compressor') processor = createMultibandCompressorProcessor(options);
	else if (type === 'noise-gate') processor = createOfflineNoiseGateProcessor(options);
	else if (isStandardEffect(type)) processor = createStandardEffectProcessor({ ...options, type });
	else throw new RangeError(`Unsupported streamed effect: ${type}.`);
	return { latencyFrames: processor.latencyFrames,
		process: (input, output) => { processor.processBlock(input, output, output[0]!.length); }, dispose: () => processor.dispose?.() };
}

interface ClassicCoefficient { readonly b0: number; readonly b1: number; readonly b2: number; readonly a1: number; readonly a2: number }
/** Keep the offline section-major loop and its Float32 section boundaries. */
function classic(params: Readonly<Record<string, unknown>>, sampleRate: number, channelCount: number): StreamedKernel {
	const coefficients = classicFilterCoefficients(params, sampleRate / 2) as ClassicCoefficient[];
	const states = Array.from({ length: channelCount }, () => coefficients.map(() => new Float64Array(4)));
	return { process(input, output) {
		for (let channel = 0; channel < channelCount; channel++) {
			let source = input[channel]!;
			for (let index = 0; index < coefficients.length; index++) {
				classicSection(source, output[channel]!, coefficients[index]!, states[channel]![index]!);
				source = output[channel]!;
			}
		}
	} };
}
/** Isolate the hot section loop from packet iteration and processor dispatch. */
function classicSection(input: Float32Array, output: Float32Array, coefficient: ClassicCoefficient, state: Float64Array): void {
	let x1 = state[0]!, x2 = state[1]!, y1 = state[2]!, y2 = state[3]!;
	const { b0, b1, b2, a1, a2 } = coefficient;
	for (let frame = 0; frame < input.length; frame++) {
		const x = input[frame]!;
		const y = x * b0 + x1 * b1 + x2 * b2 - y1 * a1 - y2 * a2;
		x2 = x1; x1 = x; y2 = y1; y1 = y; output[frame] = y;
	}
	state[0] = x1; state[1] = x2; state[2] = y1; state[3] = y2;
}

function echo(params: Readonly<Record<string, unknown>>, sampleRate: number, channelCount: number): StreamedKernel {
	const length = Math.floor(Number(params.delaySeconds) * sampleRate), decay = Number(params.decay);
	// A delay beyond the finite selection is handled by the runner before allocating history.
	const histories = Array.from({ length: channelCount }, () => new Float32Array(length));
	let position = 0;
	return { process(input, output) {
		for (let channel = 0; channel < channelCount; channel++) {
			let cursor = position;
			const source = input[channel]!, target = output[channel]!, history = histories[channel]!;
			for (let frame = 0; frame < source.length; frame++) {
				target[frame] = source[frame]! + history[cursor]! * decay; history[cursor] = target[frame]!;
				if (++cursor === length) cursor = 0;
			}
		}
		position = (position + input[0]!.length) % length;
	} };
}
