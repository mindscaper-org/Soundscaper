/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertAudacityEffectOutput } from '../../audacity-effects/pcm-channel-validation.ts';
import { initializePffft } from '../../pffft.js';
import { normalizePhaseCorrectionParams, type PhaseCorrectionParams } from './definition.ts';
import { phaseCorrectionPeakBytes } from './contract.ts';
import { createPhaseWindowEstimator, type PhaseWindowEstimate } from './correlation.ts';

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
	return analyzePhaseInput(input, sampleRate, normalized, context);
}

async function analyzePhaseInput(input: readonly Float32Array[], sampleRate: number,
	normalized: PhaseCorrectionParams, context: PhaseCorrectionContext): Promise<PhaseCorrectionAnalysis> {
	const frames = input[0]!.length;
	const uncertain: PhaseCorrectionAnalysis = { status: 'uncertain', lagSamples: 0, confidence: 0, windowsAnalyzed: 0 };
	if (frames < 256 || normalized.maximumShiftMs === 0) return uncertain;
	await initializePffft();
	assertCurrent(context);
	let windowFrames = 256;
	while (windowFrames * 2 <= Math.min(frames, sampleRate * .086)) windowFrames *= 2;
	const count = Math.min(9, Math.max(1, Math.ceil(frames / windowFrames)));
	const maximumShift = normalized.maximumShiftMs * sampleRate / 1000;
	const estimateWindow = createPhaseWindowEstimator(windowFrames, Math.ceil(maximumShift));
	const confidenceFloor = normalized.minimumConfidence / 100;
	const reliable: PhaseWindowEstimate[] = [];
	let windowsAnalyzed = 0;
	for (let index = 0; index < count; index++) {
		assertCurrent(context);
		const start = count === 1 ? 0 : Math.round((frames - windowFrames) * index / (count - 1));
		const estimate = estimateWindow(input[0]!, input[1]!, start);
		if (estimate) {
			windowsAnalyzed++;
			if (estimate.reliable && estimate.confidence >= confidenceFloor) reliable.push(estimate);
		}
		context.onProgress?.((index + 1) / count * .5);
	}
	assertCurrent(context);
	if (!reliable.length || reliable.length < windowsAnalyzed * .75) return { ...uncertain, windowsAnalyzed };
	reliable.sort((a, b) => a.lag - b.lag);
	const lag = reliable[Math.floor(reliable.length / 2)]!.lag;
	if (Math.abs(lag) > maximumShift) return { ...uncertain, windowsAnalyzed };
	let confidence = 1;
	for (const estimate of reliable) {
		if (Math.abs(estimate.lag - lag) > .5) return { ...uncertain, windowsAnalyzed };
		confidence = Math.min(confidence, estimate.confidence);
	}
	return { status: Math.abs(lag) < .025 ? 'aligned' : 'correctable', lagSamples: lag,
		confidence, windowsAnalyzed };
}

/** Fixed fractional delay, with the reference and the selection's geometry preserved. */
export async function applyPhaseCorrection(channels: unknown, sampleRate: number,
	params: Readonly<Record<string, unknown>> = {}, context: PhaseCorrectionContext = {}): Promise<Float32Array[]> {
	const normalized = normalizePhaseCorrectionParams(params);
	assertCurrent(context);
	const input = validate(channels, sampleRate);
	const analysis = await analyzePhaseInput(input, sampleRate, normalized, context);
	assertCurrent(context);
	context.onPhaseCorrectionAnalysis?.(analysis);
	assertCurrent(context);
	if (analysis.status !== 'correctable' || context.phaseCorrectionAnalyzeOnly) return input.map(channel => channel.slice());
	const targetIndex = normalized.reference === 'left' ? 1 : 0;
	const shift = analysis.lagSamples * (targetIndex === 1 ? 1 : -1);
	const target = input[targetIndex]!;
	const native = Object.getPrototypeOf(input) === Array.prototype && input.map === Array.prototype.map
		&& !Object.hasOwn(input, 'constructor') && Object.getPrototypeOf(target) === Float32Array.prototype
		&& target.slice === Float32Array.prototype.slice && target.subarray === Float32Array.prototype.subarray
		&& !Object.hasOwn(target, 'constructor');
	const output = input.map((channel, index) => native && index === targetIndex ? new Float32Array(channel.length) : channel.slice());
	const destination = output[targetIndex]!;
	const integer = Math.floor(shift), fraction = shift - integer;
	const radius = fraction === 0 ? 0 : 24;
	const tapOffset = integer + (radius ? 1 - radius : 0);
	const weights = radius ? new Float64Array(radius * 2) : null;
	let weightSum = 0;
	if (weights) for (let tap = 0; tap < weights.length; tap++) {
		const distance = tap - radius + 1 - fraction;
		const argument = Math.PI * distance;
		const weight = (argument === 0 ? 1 : Math.sin(argument) / argument) * (.5 + .5 * Math.cos(argument / radius));
		weights[tap] = weight; weightSum += weight;
	}
	const first = Math.max(0, -tapOffset);
	const end = Math.min(target.length, target.length - integer - radius);
	const fade = Math.min(32, (end - first) / 2);
	if (native) {
		if (first >= end) destination.set(target);
		else {
			if (first > 0) destination.set(target.subarray(0, first));
			if (end < target.length) destination.set(target.subarray(end), end);
		}
	}
	const solidStart = Math.ceil(first + fade), solidEnd = Math.floor(end - 1 - fade) + 1;
	for (let frame = first; frame < end;) {
		if (frame % 65536 === 0) { assertCurrent(context); context.onProgress?.(.5 + frame / target.length * .5); }
		const limit = Math.min(end, (Math.floor(frame / 65536) + 1) * 65536);
		for (; frame < limit && frame < solidStart; frame++) writeFade(frame);
		if (weights) {
			const stop = Math.min(limit, solidEnd);
			for (; frame < stop; frame++) destination[frame] = readFractionalSample(target, frame + tapOffset, weights) / weightSum;
		} else {
			const stop = Math.min(limit, solidEnd);
			for (; frame < stop; frame++) destination[frame] = 0 + target[frame + tapOffset]!;
		}
		for (; frame < limit; frame++) writeFade(frame);
	}
	assertCurrent(context);
	context.onProgress?.(1);
	return assertAudacityEffectOutput(output);

	function writeFade(frame: number): void {
		const blend = Math.min(1, (frame - first) / fade, (end - 1 - frame) / fade);
		const wet = weights ? readFractionalSample(target, frame + tapOffset, weights) / weightSum : 0 + target[frame + tapOffset]!;
		destination[frame] = blend === 1 ? wet : target[frame]! * (1 - blend) + wet * blend;
	}
}

function readFractionalSample(input: Float32Array, start: number, weights: Float64Array): number {
	let wet = 0;
	for (let tap = 0; tap < weights.length; tap++) wet += input[start + tap]! * weights[tap]!;
	return wet;
}
