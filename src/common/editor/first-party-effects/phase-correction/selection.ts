/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertAudacityEffectOutput } from '../../audacity-effects/pcm-channel-validation.ts';
import { initializePffft } from '../../pffft.js';
import { normalizePhaseCorrectionParams } from './definition.ts';
import { phaseCorrectionPeakBytes } from './contract.ts';
import { estimatePhaseWindow } from './correlation.ts';

export interface PhaseCorrectionAnalysis {
	readonly status: 'correctable' | 'aligned' | 'uncertain';
	readonly lagSamples: number;
	readonly confidence: number;
	readonly windowsAnalyzed: number;
}

export interface PhaseCorrectionContext {
	readonly isCancelled?: () => boolean;
	readonly onProgress?: (progress: number) => void;
	readonly onPhaseCorrectionAnalysis?: (analysis: PhaseCorrectionAnalysis) => void;
	readonly phaseCorrectionAnalyzeOnly?: boolean;
}

function assertCurrent(context: PhaseCorrectionContext): void {
	if (context.isCancelled?.()) throw new DOMException('Phase correction was cancelled.', 'AbortError');
}

function validate(channels: unknown, sampleRate: number): Float32Array[] {
	const input = assertAudacityEffectOutput(channels);
	phaseCorrectionPeakBytes(input[0]!.length, { sampleRate, channelCount: input.length });
	return input;
}

/** Sample up to nine evenly spaced windows; accept only a stable, unique delay. */
export async function analyzePhaseCorrection(channels: unknown, sampleRate: number,
	params: Readonly<Record<string, unknown>> = {}, context: PhaseCorrectionContext = {}): Promise<PhaseCorrectionAnalysis> {
	assertCurrent(context);
	const input = validate(channels, sampleRate), normalized = normalizePhaseCorrectionParams(params);
	const frames = input[0]!.length;
	const uncertain: PhaseCorrectionAnalysis = { status: 'uncertain', lagSamples: 0, confidence: 0, windowsAnalyzed: 0 };
	if (frames < 256 || normalized.maximumShiftMs === 0) return uncertain;
	await initializePffft();
	assertCurrent(context);
	let windowFrames = 256;
	while (windowFrames * 2 <= Math.min(frames, sampleRate * .086)) windowFrames *= 2;
	const count = Math.min(9, Math.max(1, Math.ceil(frames / windowFrames)));
	const maximumLag = Math.ceil(normalized.maximumShiftMs * sampleRate / 1000);
	const estimates = [];
	for (let index = 0; index < count; index++) {
		assertCurrent(context);
		const start = count === 1 ? 0 : Math.round((frames - windowFrames) * index / (count - 1));
		const estimate = estimatePhaseWindow(input[0]!, input[1]!, start, windowFrames, maximumLag);
		if (estimate) estimates.push(estimate);
		context.onProgress?.((index + 1) / count * .5);
	}
	assertCurrent(context);
	const reliable = estimates.filter(estimate => estimate.reliable && estimate.confidence >= normalized.minimumConfidence / 100);
	if (!reliable.length || reliable.length < estimates.length * .75) return { ...uncertain, windowsAnalyzed: estimates.length };
	reliable.sort((a, b) => a.lag - b.lag);
	const lag = reliable[Math.floor(reliable.length / 2)]!.lag;
	if (Math.abs(lag) > normalized.maximumShiftMs * sampleRate / 1000
		|| reliable.some(estimate => Math.abs(estimate.lag - lag) > .5)) return { ...uncertain, windowsAnalyzed: estimates.length };
	return { status: Math.abs(lag) < .025 ? 'aligned' : 'correctable', lagSamples: lag,
		confidence: Math.min(...reliable.map(estimate => estimate.confidence)), windowsAnalyzed: estimates.length };
}

/** Fixed fractional delay, with the reference and the selection's geometry preserved. */
export async function applyPhaseCorrection(channels: unknown, sampleRate: number,
	params: Readonly<Record<string, unknown>> = {}, context: PhaseCorrectionContext = {}): Promise<Float32Array[]> {
	const normalized = normalizePhaseCorrectionParams(params);
	const input = validate(channels, sampleRate);
	const analysis = await analyzePhaseCorrection(input, sampleRate, params, context);
	assertCurrent(context);
	context.onPhaseCorrectionAnalysis?.(analysis);
	assertCurrent(context);
	const output = input.map(channel => channel.slice());
	if (analysis.status !== 'correctable' || context.phaseCorrectionAnalyzeOnly) return output;
	const targetIndex = normalized.reference === 'left' ? 1 : 0;
	const shift = analysis.lagSamples * (targetIndex === 1 ? 1 : -1);
	const target = input[targetIndex]!, destination = output[targetIndex]!;
	const integer = Math.floor(shift), fraction = shift - integer;
	const radius = fraction === 0 ? 0 : 24;
	const weights = new Float64Array(radius ? radius * 2 : 1);
	let weightSum = 0;
	for (let tap = 0; tap < weights.length; tap++) {
		const distance = tap - radius + (radius ? 1 : 0) - fraction;
		const argument = Math.PI * distance;
		const weight = radius ? (argument === 0 ? 1 : Math.sin(argument) / argument) * (.5 + .5 * Math.cos(argument / radius)) : 1;
		weights[tap] = weight; weightSum += weight;
	}
	const first = Math.max(0, -integer + (radius ? radius - 1 : 0));
	const end = Math.min(target.length, target.length - integer - radius);
	const fade = Math.min(32, (end - first) / 2);
	for (let frame = first; frame < end; frame++) {
		if (frame % 65536 === 0) { assertCurrent(context); context.onProgress?.(.5 + frame / target.length * .5); }
		let wet = 0;
		for (let tap = 0; tap < weights.length; tap++) wet += target[frame + integer + tap - radius + (radius ? 1 : 0)]! * weights[tap]!;
		const blend = Math.min(1, (frame - first) / fade, (end - 1 - frame) / fade);
		destination[frame] = blend === 1 ? wet / weightSum : target[frame]! * (1 - blend) + wet / weightSum * blend;
	}
	assertCurrent(context);
	context.onProgress?.(1);
	return assertAudacityEffectOutput(output);
}
